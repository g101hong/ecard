/**
 * @fileoverview svg-engine/png-exporter.js
 * @description  정적 경승지 이미지(JPG) → PNG 변환 + 답글 카드 합성
 *
 * [방안D] 기존에는 SVG 문자열을 sharp로 래스터라이즈했으나, 이제는
 * 미리 채색된 정적 이미지(assets/scenes/ulsan_scene_XX.jpg)를 입력으로
 * 받는다. sharp는 SVG/JPG/PNG 등 다양한 포맷을 동일한 방식으로 처리할
 * 수 있으므로, 입력을 "이미지 버퍼"로 일반화하고 합성 로직(답글 카드,
 * 글로우 배경)은 그대로 재사용한다.
 *
 * 레이아웃:
 *   ┌──────────────────────────┐
 *   │  경승지 이미지            │  (sharp — JPG/PNG 디코딩)
 *   ├──────────────────────────┤
 *   │  답글 카드                │  (@napi-rs/canvas — TTF 직접 로드)
 *   │   ────                   │  황금 구분선
 *   │   main  감성별 폰트       │
 *   │   place 감성별 폰트       │
 *   │   ULSAN tagline           │
 *   └──────────────────────────┘
 *
 * 폰트: assets/*.ttf → GlobalFonts.registerFromPath()
 *   librsvg/시스템 폰트 설치 불필요.
 *
 * [변경 이력]
 *   4색 동기화: buildReplyBgSVG(primary, secondary) → (primary, secondary, tertiary, quaternary)
 *   clinet applyGlowColors() 와 CSS 변수 1:1 대응:
 *     rg1 tertiary   → --reply-main  (우상단 방사형 빛, opacity 0.18)
 *     rg2 quaternary → --reply-sub   (좌하단 방사형 빛, opacity 0.12)
 *     rg3 primary    → --glow-primary   (상단 글로우 핵심, opacity 0.42)
 *     rg4 secondary  → --glow-secondary (상단 글로우 보조, opacity 0.30)
 *   [방안D] svgToPng(svgString, ...) → composeCardPNG(imageBuffer, ...)
 *     입력이 SVG 문자열에서 정적 이미지 버퍼(JPG)로 변경됨.
 *     sharp(svgBuf) → sharp(imageBuf)로 호출부만 변경, 나머지 합성
 *     파이프라인(STEP 2~6)은 동일하게 유지.
 */

'use strict';

import sharp                         from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdir }                     from 'fs/promises';
import { existsSync }                from 'fs';
import path                          from 'path';
import { fileURLToPath }             from 'url';
import { EMOTION_FONT_MAP,
         FALLBACK_FONT,
         pickFontByEmotion }         from './emotion-fonts.js';
import { extractDominantColors }     from './emotion-colors.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../assets');

// ── 폰트 등록 (모듈 최초 로드 시 1회) ─────────────────────────
let _fontsRegistered = false;
const _availableFonts = new Set();

function ensureFonts() {
  if (_fontsRegistered) return;
  _fontsRegistered = true;

  for (const [emotion, fontInfo] of Object.entries(EMOTION_FONT_MAP)) {
    const ttfPath = path.join(ASSETS_DIR, fontInfo.ttfPath);
    if (!existsSync(ttfPath)) {
      console.warn(`[png-exporter] ${fontInfo.ttfPath} 없음 → ${emotion} 감성은 폴백 폰트 사용`);
      continue;
    }
    try {
      GlobalFonts.registerFromPath(ttfPath, fontInfo.family);
      _availableFonts.add(fontInfo.family);
    } catch (err) {
      console.warn(`[png-exporter] ${fontInfo.family} 등록 실패:`, err.message);
    }
  }

  console.log(
    `[png-exporter] 폰트 등록 완료 (${_availableFonts.size}/${Object.keys(EMOTION_FONT_MAP).length}):`,
    [..._availableFonts].join(', '),
  );
}

function resolveFontFamily(emotionScores) {
  ensureFonts();
  const { font } = pickFontByEmotion(emotionScores);
  if (_availableFonts.has(font.family)) return font.family;
  return FALLBACK_FONT.family;
}

// ── 출력 설정 ──────────────────────────────────────────────────
const CFG = Object.freeze({
  DEFAULT_WIDTH:      1200,
  COMPRESSION_LEVEL:  8,
  CARD_RATIO:         0.46,
  PAD_X_RATIO:        0.07,
  BG_IMAGE:           '#FFF8F0',   // 아이보리
  BG_CARD:            '#FDF2E8',   // 카드 배경
  LINE_DIVIDER:       '#DDD0BE',   // 경계선
  COLOR_ACCENT:       '#C88C1A',   // 황금 구분선
  COLOR_MAIN:         '#1A1410',   // 주 텍스트
  COLOR_PLACE:        '#6B5A4A',   // 보조 텍스트
  COLOR_TAGLINE:      '#C88C1A',   // tagline
  FONT_HAND:          'Nanum Pen Script',
  FONT_SANS:          'Noto Sans CJK KR',
});

// ── 유틸 ──────────────────────────────────────────────────────
async function ensureDir(p) {
  await mkdir(path.dirname(p), { recursive: true });
}

// ── 텍스트 줄바꿈 유틸 ────────────────────────────────────────
function breakLines(ctx, text, maxWidth) {
  const tokens = text.split(' ');
  const lines  = [];
  let cur = '';

  for (const token of tokens) {
    const candidate = cur ? `${cur} ${token}` : token;
    if (ctx.measureText(candidate).width <= maxWidth) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      cur = '';
      let charBuf = '';
      for (const ch of token) {
        const next = charBuf + ch;
        if (ctx.measureText(next).width <= maxWidth) {
          charBuf = next;
        } else {
          if (charBuf) lines.push(charBuf);
          charBuf = ch;
        }
      }
      cur = charBuf;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fillWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const lines = breakLines(ctx, text, maxWidth);
  let currentY = y;
  for (const line of lines) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

// =============================================================================
// buildReplyBgSVG — 배경·글로우 전용 SVG 생성 (4색 버전)
// =============================================================================
/**
 * 답글 카드의 배경(아이보리) + 방사형 빛 + 상단 글로우를
 * SVG <radialGradient>로 생성한다.
 *
 * 클라이언트 CSS 변수와 1:1 대응:
 *   rg1 tertiary   → --reply-main     우상단 방사형 빛 (opacity 0.18)
 *   rg2 quaternary → --reply-sub      좌하단 방사형 빛 (opacity 0.12)
 *   rg3 primary    → --glow-primary   상단 글로우 핵심 (opacity 0.42)
 *   rg4 secondary  → --glow-secondary 상단 글로우 보조 (opacity 0.30)
 *
 * @param {number} W           카드 너비(px)
 * @param {number} H           카드 높이(px)
 * @param {string} primary     주색1 hex — 상단 글로우 핵심
 * @param {string} secondary   주색2 hex — 상단 글로우 보조
 * @param {string} tertiary    주색3 hex — 방사형 빛 우상단
 * @param {string} quaternary  주색4 hex — 방사형 빛 좌하단
 * @returns {string}  SVG 문자열
 */
function buildReplyBgSVG(W, H, primary, secondary, tertiary, quaternary) {
  const hx = hex => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r},${g},${b})`;
  };

  const makeRG = (id, W, H, cxR, cyR, rxR, ryR, colorHex, stops) => {
    const cx = W * cxR;
    const cy = H * cyR;
    const rx = W * rxR;
    const ry = H * ryR;
    const r  = Math.max(rx, ry);
    const sx = rx / r;
    const sy = ry / r;
    const col = hx(colorHex);

    const stopTags = stops.map(({ pos, alpha }) =>
      `<stop offset="${(pos * 100).toFixed(1)}%"` +
      ` stop-color="${col}" stop-opacity="${alpha.toFixed(3)}"/>`
    ).join('\n      ');

    return `<radialGradient id="${id}"
      gradientUnits="userSpaceOnUse"
      cx="0" cy="0" r="${r.toFixed(2)}"
      gradientTransform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${sx.toFixed(6)},${sy.toFixed(6)})">
      ${stopTags}
    </radialGradient>`;
  };

  // ── 방사형 빛 (reply-card background) ─────────────────────────
  // CSS: ellipse 62% 45% at 88% 8%  → --reply-main  (tertiary,  0.18)
  const rg1 = makeRG('rg1', W, H,
    0.88, 0.08, 0.62, 0.45, tertiary, [
      { pos: 0.00, alpha: 0.18 },
      { pos: 0.45, alpha: 0.07 },
      { pos: 0.68, alpha: 0.00 },
    ]);
  // CSS: ellipse 50% 38% at 12% 92% → --reply-sub   (quaternary, 0.12)
  const rg2 = makeRG('rg2', W, H,
    0.12, 0.92, 0.50, 0.38, quaternary, [
      { pos: 0.00, alpha: 0.12 },
      { pos: 0.50, alpha: 0.05 },
      { pos: 0.62, alpha: 0.00 },
    ]);

  // ── 상단 글로우 (reply-card::before, height=55%) ──────────────
  // CSS: ellipse 85% 70% at 50% 0%  → --glow-primary   (primary,   0.42)
  const glowH = Math.round(H * 0.55);
  const rg3 = makeRG('rg3', W, glowH,
    0.50, 0.00, 0.85, 0.70, primary, [
      { pos: 0.00, alpha: 0.42 },
      { pos: 0.35, alpha: 0.22 },
      { pos: 0.70, alpha: 0.00 },
    ]);
  // CSS: ellipse 55% 55% at 82% 0%  → --glow-secondary (secondary, 0.30)
  const rg4 = makeRG('rg4', W, glowH,
    0.82, 0.00, 0.55, 0.55, secondary, [
      { pos: 0.00, alpha: 0.30 },
      { pos: 0.40, alpha: 0.12 },
      { pos: 0.68, alpha: 0.00 },
    ]);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    ${rg1}
    ${rg2}
    ${rg3}
    ${rg4}
  </defs>

  <!-- 배경: 아이보리 베이스 -->
  <rect width="${W}" height="${H}" fill="${CFG.BG_CARD}"/>

  <!-- 방사형 빛: 우상단 tertiary, opacity 0.18 -->
  <rect width="${W}" height="${H}" fill="url(#rg1)"/>

  <!-- 방사형 빛: 좌하단 quaternary, opacity 0.12 -->
  <rect width="${W}" height="${H}" fill="url(#rg2)"/>

  <!-- 상단 글로우 primary, opacity 0.42 -->
  <rect width="${W}" height="${glowH}" fill="url(#rg3)"/>

  <!-- 상단 글로우 secondary, opacity 0.30 -->
  <rect width="${W}" height="${glowH}" fill="url(#rg4)"/>
</svg>`;
}

// =============================================================================
// buildReplyCardBuffer — 텍스트 레이어 canvas 생성
// =============================================================================
function buildReplyCardBuffer(reply, W, emotionScores = null) {
  const fontFamily = resolveFontFamily(emotionScores);

  const px       = Math.round(W * CFG.PAD_X_RATIO);
  const maxTextW = W - px * 2;

  const fMain  = Math.round(W * 0.0576);
  const fPlace = Math.round(W * 0.0411);
  const fTag   = Math.round(W * 0.0329);

  // Nanum Pen Script — 다른 폰트 대비 작게 렌더되므로 warmth 전용 크기 보정 (+14%)
  const _isWarmth = (fontFamily === 'Nanum Pen Script');
  const fMainAdj  = _isWarmth ? Math.round(fMain  * 1.143) : fMain;
  const fPlaceAdj = _isWarmth ? Math.round(fPlace * 1.150) : fPlace;

  const lhMain  = Math.round(fMainAdj  * 1.45);
  const lhPlace = Math.round(fPlaceAdj * 1.45);
  const lhTag   = Math.round(fTag   * 1.45);

  const dummy = createCanvas(W, 10);
  const dctx  = dummy.getContext('2d');

  dctx.font = `bold ${fMainAdj}px '${fontFamily}'`;
  const mainLines  = breakLines(dctx, reply.main  ?? '', maxTextW);

  dctx.font = `${fPlaceAdj}px '${fontFamily}'`;
  const placeLines = breakLines(dctx, reply.place ?? '', maxTextW);

  dctx.font = `${fTag}px '${fontFamily}'`;
  const tagText  = (reply.tagline ?? '').replace(/—/g, '-');
  const tagLines = breakLines(dctx, tagText, maxTextW);

  const padTop   = Math.round(W * 0.08);
  const padBot   = Math.round(W * 0.06);
  const gapBlock = Math.round(W * 0.04);

  const lineY      = padTop;
  const mainY      = lineY  + Math.round(W * 0.06);
  const mainBlock  = mainLines.length  * lhMain;
  const placeY     = mainY  + mainBlock  + gapBlock;
  const placeBlock = placeLines.length * lhPlace;
  const tagY       = placeY + placeBlock + gapBlock;
  const tagBlock   = tagLines.length * lhTag;
  const H          = tagY + tagBlock + padBot;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle   = CFG.LINE_DIVIDER;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 0, W, 1);
  ctx.globalAlpha = 1;

  ctx.fillStyle = CFG.COLOR_ACCENT;
  ctx.beginPath();
  ctx.roundRect(px, lineY, Math.round(W * 0.05), 2, 1);
  ctx.fill();

  ctx.fillStyle     = CFG.COLOR_MAIN;
  ctx.font          = `bold ${fMainAdj}px '${fontFamily}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.main ?? '', px, mainY, maxTextW, lhMain);

  ctx.fillStyle     = CFG.COLOR_PLACE;
  ctx.font          = `${fPlaceAdj}px '${fontFamily}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.place ?? '', px, placeY, maxTextW, lhPlace);

  ctx.fillStyle     = CFG.COLOR_TAGLINE;
  ctx.font          = `${fTag}px '${fontFamily}'`;
  ctx.letterSpacing = '2px';
  fillWrappedText(ctx, tagText, px, tagY, maxTextW, lhTag);

  return { buf: canvas.toBuffer('image/png'), cardH: H };
}

// =============================================================================
// composeCardPNG — 메인 변환 + 합성 함수 [방안D]
// =============================================================================
/**
 * 정적 경승지 이미지(JPG) 버퍼를 PNG로 리사이즈하고,
 * reply가 있으면 답글 카드를 합성한다.
 *
 * [방안D] 기존 svgToPng(svgString, ...)를 대체. 입력이 SVG 문자열에서
 * 이미지 버퍼로 바뀌었을 뿐, sharp 기반 합성 파이프라인(STEP 2~6)은
 * 동일하다 — sharp는 입력 포맷(SVG/JPG/PNG)을 자동 인식하여 디코딩한다.
 *
 * @param {Buffer}      imageBuffer      정적 경승지 이미지 버퍼 (JPG)
 * @param {string}      outputPath
 * @param {number}      [size=1200]
 * @param {Object|null} [reply]          { main, place, tagline }
 * @param {Object|null} [emotionScores]  8차원 감성 점수
 * @returns {Promise<string>}
 */
export async function composeCardPNG(
  imageBuffer,
  outputPath,
  size          = CFG.DEFAULT_WIDTH,
  reply         = null,
  emotionScores = null,
) {
  if (!imageBuffer?.length) throw new Error('imageBuffer가 비어있습니다.');
  if (!outputPath)          throw new Error('outputPath가 없습니다.');

  const W = Math.round(Math.max(400, Math.min(2400, size)));
  await ensureDir(outputPath);

  // STEP 1: 정적 이미지 → 지정 너비로 리사이즈
  const imgBuf = await sharp(imageBuffer)
    .resize({ width: W })
    .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
    .toBuffer();

  if (!reply?.main) {
    await sharp(imgBuf).toFile(outputPath);
    return outputPath;
  }

  // STEP 2: 실제 이미지 크기 확인 (JPG는 metadata로 정확한 높이를 바로 얻는다)
  const { width: IW, height: IH } = await sharp(imgBuf).metadata();
  const imgW = IW ?? W;
  const imgH = IH ?? W; // 메타데이터를 못 읽는 극히 예외적인 경우의 안전망 (정사각 가정)

  // STEP 3: 감성 주색 4종 추출 (emotion-colors.js)
  const colorResult = extractDominantColors(emotionScores);
  const {
    primary    = '#888888',
    secondary  = '#888888',
    tertiary   = '#888888',
    quaternary = '#888888',
  } = colorResult ?? {};

  // STEP 4: 텍스트 캔버스 생성 (cardH 확정)
  const { buf: textBuf, cardH } = buildReplyCardBuffer(reply, imgW, emotionScores);

  // STEP 5: 배경+글로우 SVG 래스터라이즈 (4색 전달)
  const bgSvgStr = buildReplyBgSVG(imgW, cardH, primary, secondary, tertiary, quaternary);
  const bgBuf    = await sharp(Buffer.from(bgSvgStr, 'utf-8'))
    .resize({ width: imgW })
    .png()
    .toBuffer();

  // STEP 6: 최종 합성
  //   Layer 0: 아이보리 베이스 (sharp create)
  //   Layer 1: 경승지 이미지 (imgBuf)
  //   Layer 2: 배경+방사형+글로우 SVG 래스터 (bgBuf)  ← 웹 CSS와 동일
  //   Layer 3: 텍스트 canvas (textBuf)
  await sharp({
    create: {
      width:      imgW,
      height:     imgH + cardH,
      channels:   4,
      background: CFG.BG_IMAGE,
    },
  })
  .composite([
    { input: imgBuf,  top: 0,    left: 0 },
    { input: bgBuf,   top: imgH, left: 0 },
    { input: textBuf, top: imgH, left: 0 },
  ])
  .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
  .toFile(outputPath);

  return outputPath;
}

export default { composeCardPNG };
