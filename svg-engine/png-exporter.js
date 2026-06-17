/**
 * @fileoverview svg-engine/png-exporter.js
 * @description  SVG → PNG 변환 + 답글 카드 합성
 *
 * 레이아웃:
 *   ┌──────────────────────────┐
 *   │  스테인드글라스 이미지     │  (sharp — librsvg 경유)
 *   ├──────────────────────────┤
 *   │  답글 카드                │  (@napi-rs/canvas — TTF 직접 로드)
 *   │   ────                   │  황금 구분선
 *   │   main  나눔손글씨 와일드  │
 *   │   place 나눔손글씨 와일드  │
 *   │   ULSAN tagline           │
 *   └──────────────────────────┘
 *
 * 폰트: assets/NanumWaIrDeu.ttf → GlobalFonts.registerFromPath()
 *   librsvg/시스템 폰트 설치 불필요.
 */

'use strict';

import sharp                        from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdir, readFile }          from 'fs/promises';
import { existsSync }               from 'fs';
import path                         from 'path';
import { fileURLToPath }            from 'url';
import { EMOTION_FONT_MAP,
         FALLBACK_FONT,
         pickFontByEmotion }        from './emotion-fonts.js';
import { extractDominantColors }    from './emotion-colors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../assets');

// ── 폰트 등록 (모듈 최초 로드 시 1회) ─────────────────────────
// 8개 감성 폰트 TTF를 모두 시도해서 GlobalFonts에 등록한다.
// assets/에 파일이 없으면 해당 폰트는 등록 건너뛰고 폴백된다.
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

/**
 * 감성에 맞는 폰트 family명을 반환한다.
 * 해당 폰트가 등록 안 되어 있으면 NanumWaIrDeu 폴백.
 */
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
  BG_IMAGE:           '#FFF8F0',   // 아이보리 (라이트)
  BG_CARD:            '#FDF2E8',   // 카드 배경 (라이트)
  LINE_DIVIDER:       '#DDD0BE',   // 경계선 (라이트)
  COLOR_ACCENT:       '#C88C1A',   // 황금 구분선
  COLOR_MAIN:         '#1A1410',   // 주 텍스트 (다크)
  COLOR_PLACE:        '#6B5A4A',   // 보조 텍스트
  COLOR_TAGLINE:      '#C88C1A',   // tagline
  FONT_HAND:          'NanumWaIrDeu',
  FONT_SANS:          'Noto Sans CJK KR',
});

// ── 유틸 ──────────────────────────────────────────────────────
async function ensureDir(p) {
  await mkdir(path.dirname(p), { recursive: true });
}

function parseSvgRatio(svgString) {
  const m = svgString.match(/viewBox=["']([^"']+)["']/);
  if (!m) return 1.0;
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  return (p.length >= 4 && p[2] > 0 && p[3] > 0) ? p[3] / p[2] : 1.0;
}

/** hex + alpha → rgba 문자열 (canvas fillStyle 용) */
function _hexWithAlpha(hex, alpha) {
  if (!hex || hex.length < 7) return `rgba(200,168,75,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── 텍스트 줄바꿈 유틸 ────────────────────────────────────────
/**
 * maxWidth를 넘는 텍스트를 단어/음절 단위로 줄바꿈하여 줄 배열을 반환한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function breakLines(ctx, text, maxWidth) {
  const words = text.split('');   // 한글은 글자 단위로 분리
  const lines = [];
  let cur = '';

  // 공백 기준으로 먼저 단어 분리, 단어 내에서 글자 단위 줄바꿈
  const tokens = text.split(' ');
  cur = '';

  for (const token of tokens) {
    const candidate = cur ? `${cur} ${token}` : token;
    if (ctx.measureText(candidate).width <= maxWidth) {
      cur = candidate;
    } else {
      // 현재까지 쌓인 줄 저장 후, 긴 토큰은 글자 단위로 쪼갬
      if (cur) lines.push(cur);
      cur = '';

      // 토큰 자체가 maxWidth보다 길면 글자 단위로 분리
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

/**
 * 줄바꿈을 적용해 텍스트를 그리고, 실제 사용된 높이를 반환한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x       시작 X
 * @param {number} y       첫 줄 baseline Y
 * @param {number} maxWidth
 * @param {number} lineHeight
 * @returns {number}  마지막 줄 baseline Y
 */
function fillWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const lines = breakLines(ctx, text, maxWidth);
  let currentY = y;
  for (const line of lines) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

// ── 답글 카드 PNG 버퍼 생성 (@napi-rs/canvas) ─────────────────
function buildReplyCardBuffer(reply, W, emotionScores = null) {
  // dominant 감성에 맞는 폰트 결정 (없으면 NanumWaIrDeu)
  const fontFamily = resolveFontFamily(emotionScores);

  const px      = Math.round(W * CFG.PAD_X_RATIO);
  const maxTextW = W - px * 2;   // 텍스트 최대 너비 (양쪽 패딩 제외)

  const fMain   = Math.round(W * 0.0576);
  const fPlace  = Math.round(W * 0.0512);
  const fTag    = Math.round(W * 0.0288);

  const lhMain  = Math.round(fMain  * 1.45);
  const lhPlace = Math.round(fPlace * 1.45);
  const lhTag   = Math.round(fTag   * 1.45);

  // ── 텍스트 높이 사전 측정 (더미 캔버스) ─────────────────────
  const dummy = createCanvas(W, 10);
  const dctx  = dummy.getContext('2d');

  dctx.font = `bold ${fMain}px '${fontFamily}'`;
  const mainLines  = breakLines(dctx, reply.main  ?? '', maxTextW);

  dctx.font = `${fPlace}px '${fontFamily}'`;
  const placeLines = breakLines(dctx, reply.place ?? '', maxTextW);

  dctx.font = `${fTag}px '${fontFamily}'`;
  const tagText    = (reply.tagline ?? '').replace(/—/g, '-');
  const tagLines   = breakLines(dctx, tagText, maxTextW);

  // ── 카드 높이 동적 계산 ──────────────────────────────────────
  const padTop    = Math.round(W * 0.08);   // 상단 여백
  const padBot    = Math.round(W * 0.06);   // 하단 여백
  const gapBlock  = Math.round(W * 0.04);   // 블록 간 간격

  const lineY     = padTop;
  const mainY     = lineY + Math.round(W * 0.06);
  const mainBlock = mainLines.length  * lhMain;

  const placeY    = mainY + mainBlock + gapBlock;
  const placeBlock = placeLines.length * lhPlace;

  const tagY      = placeY + placeBlock + gapBlock;
  const tagBlock  = tagLines.length * lhTag;

  const H = tagY + tagBlock + padBot;

  // ── 실제 캔버스 렌더링 ────────────────────────────────────────
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── 배경 1: 단색 아이보리 베이스 ───────────────────────────────
  ctx.fillStyle = CFG.BG_CARD;
  ctx.fillRect(0, 0, W, H);

  // 상단 경계선
  ctx.fillStyle = CFG.LINE_DIVIDER;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 0, W, 1);
  ctx.globalAlpha = 1;

  // 황금 구분 단선
  ctx.fillStyle = CFG.COLOR_ACCENT;
  ctx.beginPath();
  ctx.roundRect(px, lineY, Math.round(W * 0.05), 2, 1);
  ctx.fill();

  // main
  ctx.fillStyle = CFG.COLOR_MAIN;
  ctx.font      = `bold ${fMain}px '${fontFamily}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.main ?? '', px, mainY, maxTextW, lhMain);

  // place
  ctx.fillStyle = CFG.COLOR_PLACE;
  ctx.font      = `${fPlace}px '${fontFamily}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.place ?? '', px, placeY, maxTextW, lhPlace);

  // tagline
  ctx.fillStyle = CFG.COLOR_TAGLINE;
  ctx.font      = `${fTag}px '${fontFamily}'`;
  ctx.letterSpacing = '2px';
  fillWrappedText(ctx, tagText, px, tagY, maxTextW, lhTag);

  return { buf: canvas.toBuffer('image/png'), cardH: H };
}

// ── 메인 변환 함수 ─────────────────────────────────────────────
/**
 * SVG를 PNG로 변환하고, reply가 있으면 답글 카드를 합성한다.
 *
 * @param {string} svgString
 * @param {string} outputPath
 * @param {number} [size=1200]              이미지 너비(px)
 * @param {Object|null} [reply]             { main, place, tagline }
 * @param {Object|null} [emotionScores]     8차원 감성 점수 (폰트 선택용)
 * @returns {Promise<string>}
 */
export async function svgToPng(
  svgString,
  outputPath,
  size           = CFG.DEFAULT_WIDTH,
  reply          = null,
  emotionScores  = null,
) {
  if (!svgString?.trim()) throw new Error('svgString이 비어있습니다.');
  if (!outputPath)        throw new Error('outputPath가 없습니다.');

  const W = Math.round(Math.max(400, Math.min(2400, size)));
  await ensureDir(outputPath);

  // STEP 1: SVG → PNG 래스터라이즈 (sharp/librsvg)
  const svgBuf = Buffer.from(svgString, 'utf-8');
  const imgBuf = await sharp(svgBuf)
    .resize({ width: W })
    .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
    .toBuffer();

  // reply 없으면 이미지만 저장
  if (!reply?.main) {
    await sharp(imgBuf).toFile(outputPath);
    return outputPath;
  }

  // STEP 2: 실제 이미지 크기 확인
  const { width: IW, height: IH } = await sharp(imgBuf).metadata();
  const imgW = IW ?? W;
  const imgH = IH ?? Math.round(W * parseSvgRatio(svgString));

  // STEP 3: 답글 카드 PNG 생성 (@napi-rs/canvas — librsvg 완전 우회)
  // dominant 감성에 맞는 폰트로 렌더링됨.
  const { buf: cardBuf, cardH } = buildReplyCardBuffer(reply, imgW, emotionScores);

  // STEP 4: 이미지 + 카드 합성 → 저장
  //
  // 웹화면(reply-card CSS)과 동일한 구조로 재현:
  //   ┌─────────────────────────────┐
  //   │  SVG 스테인드글라스 이미지   │ ← imgBuf (색채 변환 없음)
  //   ├─────────────────────────────┤ ← 경계선
  //   │::before 상단 글로우          │   reply-card::before 와 동일
  //   │  ellipse 85%×70% at 50% 0%  │   alpha: primary×0.42, secondary×0.30
  //   │                             │
  //   │  방사형 빛 (방안4)           │   reply-card background 와 동일
  //   │  우상단 ellipse 62%×45%     │   alpha: primary×0.18
  //   │  좌하단 ellipse 50%×38%     │   alpha: secondary×0.12
  //   │                             │
  //   │  텍스트 (main/place/tagline) │
  //   └─────────────────────────────┘

  const compositeInputs = [
    { input: imgBuf,  top: 0,    left: 0 },
    { input: cardBuf, top: imgH, left: 0 },
  ];

  const colorResult = extractDominantColors(emotionScores);
  if (colorResult) {
    const { primary, secondary } = colorResult;

    // ── 글로우 레이어: 카드 영역만 (SVG 이미지에 걸치지 않음) ──────
    // 웹 reply-card::before: ellipse 85% 70% at 50% 0%, opacity 0.42
    //                        ellipse 55% 55% at 82% 0%, opacity 0.30
    const glowCanvas = createCanvas(imgW, cardH);
    const gc         = glowCanvas.getContext('2d');

    // 주색 — 상단 중앙에서 아래로 (웹 ::before 중앙 gradient 재현)
    const R1 = cardH * 0.70;
    const g1 = gc.createRadialGradient(
      imgW * 0.50, 0, 0,
      imgW * 0.50, 0, R1,
    );
    g1.addColorStop(0.00, _hexWithAlpha(primary,   0.42));  // 웹 opacity 0.42
    g1.addColorStop(0.35, _hexWithAlpha(primary,   0.18));
    g1.addColorStop(0.70, _hexWithAlpha(primary,   0.05));
    g1.addColorStop(1.00, _hexWithAlpha(primary,   0.00));
    gc.fillStyle = g1;
    gc.fillRect(0, 0, imgW, cardH);

    // 보조색 — 우측 상단 (웹 ::before 우측 gradient 재현)
    const R2 = cardH * 0.55;
    const g2 = gc.createRadialGradient(
      imgW * 0.82, 0, 0,
      imgW * 0.82, 0, R2,
    );
    g2.addColorStop(0.00, _hexWithAlpha(secondary, 0.30));  // 웹 opacity 0.30
    g2.addColorStop(0.40, _hexWithAlpha(secondary, 0.10));
    g2.addColorStop(1.00, _hexWithAlpha(secondary, 0.00));
    gc.fillStyle = g2;
    gc.fillRect(0, 0, imgW, cardH);

    // ── 방사형 빛 레이어: 웹 reply-card background 재현 ───────────
    // 웹: radial-gradient(ellipse 62% 45% at 88% 8%,  rgba(primary, 0.18))
    //     radial-gradient(ellipse 50% 38% at 12% 92%, rgba(secondary, 0.12))
    const radW = imgW;
    const radH = cardH;

    // 우상단 — 주색 (웹과 동일 비율)
    const rr1 = Math.max(radW * 0.62, radH * 0.45);
    const gr1 = gc.createRadialGradient(
      radW * 0.88, radH * 0.08, 0,
      radW * 0.88, radH * 0.08, rr1,
    );
    gr1.addColorStop(0.00, _hexWithAlpha(primary,   0.18));
    gr1.addColorStop(0.50, _hexWithAlpha(primary,   0.06));
    gr1.addColorStop(1.00, _hexWithAlpha(primary,   0.00));
    gc.fillStyle = gr1;
    gc.fillRect(0, 0, imgW, cardH);

    // 좌하단 — 보조색 (웹과 동일 비율)
    const rr2 = Math.max(radW * 0.50, radH * 0.38);
    const gr2 = gc.createRadialGradient(
      radW * 0.12, radH * 0.92, 0,
      radW * 0.12, radH * 0.92, rr2,
    );
    gr2.addColorStop(0.00, _hexWithAlpha(secondary, 0.12));
    gr2.addColorStop(0.50, _hexWithAlpha(secondary, 0.04));
    gr2.addColorStop(1.00, _hexWithAlpha(secondary, 0.00));
    gc.fillStyle = gr2;
    gc.fillRect(0, 0, imgW, cardH);

    const glowBuf = glowCanvas.toBuffer('image/png');
    // 카드 영역 위에만 합성 (SVG 이미지에 걸치지 않음)
    compositeInputs.push({
      input: glowBuf,
      top:   imgH,   // 카드 시작점 = 이미지 하단
      left:  0,
    });
  }

  await sharp({
    create: {
      width:      imgW,
      height:     imgH + cardH,
      channels:   4,
      background: CFG.BG_IMAGE,
    },
  })
  .composite(compositeInputs)
  .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
  .toFile(outputPath);

  return outputPath;
}

export default { svgToPng };
