/**
 * @fileoverview svg-engine/png-exporter.js
 * @description  정적 경승지 이미지(JPG) → PNG 변환 + 답글 카드 합성
 * @version 2.1.0  [v3.1] dominantEmotion 직접 사용 — 폰트 불일치 수정
 *
 * ─────────────────────────────────────────────────────────────────
 * [v3.1 변경사항] 폰트 불일치 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   resolveFontFamily(emotionScores, dominantEmotion?)
 *     dominantEmotion이 있으면 → EMOTION_FONT_MAP[dominantEmotion] 직접 사용
 *     없으면 → 기존 pickFontByEmotion(emotionScores) 폴백
 *
 *   buildReplyCardBuffer(reply, W, emotionScores, dominantEmotion?)
 *     dominantEmotion 파라미터 추가 전달
 *
 *   composeCardPNG(imageBuffer, outputPath, size, reply, emotionScores, dominantEmotion?)
 *     dominantEmotion 파라미터 추가
 *
 *   generateCardPNG({ ..., dominantEmotion? })
 *     dominantEmotion 수신 및 composeCardPNG에 전달
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안D] 정적 이미지(JPG) → PNG 합성
 * ─────────────────────────────────────────────────────────────────
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
 * 4색 글로우 동기화 (CSS applyGlowColors()와 1:1 대응):
 *   rg1 tertiary   → --reply-main  (우상단 방사형 빛, opacity 0.18)
 *   rg2 quaternary → --reply-sub   (좌하단 방사형 빛, opacity 0.12)
 *   rg3 primary    → --glow-primary   (상단 글로우 핵심, opacity 0.42)
 *   rg4 secondary  → --glow-secondary (상단 글로우 보조, opacity 0.30)
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

// =============================================================================
// ① 폰트 등록 (모듈 최초 로드 시 1회)
// =============================================================================

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
 * 사용할 폰트 family 이름을 결정한다.
 *
 * [v3.1] dominantEmotion이 있으면 직접 사용 (재계산 없음).
 *        없으면 emotionScores로 pickFontByEmotion() 폴백.
 *
 * @param {Object|null} emotionScores
 * @param {string|null} [dominantEmotion]  서버 결정값 (우선 사용)
 * @returns {string}  CSS font-family 값
 */
function resolveFontFamily(emotionScores, dominantEmotion = null) {
  ensureFonts();

  let fontInfo;

  if (dominantEmotion && EMOTION_FONT_MAP[dominantEmotion]) {
    // [v3.1] 서버 결정값 직접 사용 — 재계산 없음
    fontInfo = EMOTION_FONT_MAP[dominantEmotion];
    console.log(`[png-exporter] 폰트: ${fontInfo.family} (dominantEmotion=${dominantEmotion} 직접 사용)`);
  } else {
    // 폴백: emotionScores로 재계산
    const { font } = pickFontByEmotion(emotionScores);
    fontInfo = font;
    console.log(`[png-exporter] 폰트: ${fontInfo.family} (emotionScores 재계산)`);
  }

  if (_availableFonts.has(fontInfo.family)) return fontInfo.family;

  console.warn(`[png-exporter] ${fontInfo.family} 미등록 → 폴백 폰트 사용`);
  return FALLBACK_FONT.family;
}

// =============================================================================
// ② 출력 설정
// =============================================================================

const CFG = Object.freeze({
  DEFAULT_WIDTH:      1200,
  COMPRESSION_LEVEL:  8,
  PAD_X_RATIO:        0.07,
  BG_IMAGE:           '#FFF8F0',
  BG_CARD:            '#FDF2E8',
  LINE_DIVIDER:       '#DDD0BE',
  COLOR_ACCENT:       '#C88C1A',
  COLOR_MAIN:         '#1A1410',
  COLOR_PLACE:        '#6B5A4A',
  COLOR_TAGLINE:      '#C88C1A',
});

// =============================================================================
// ③ 유틸
// =============================================================================

async function ensureDir(p) {
  await mkdir(path.dirname(p), { recursive: true });
}

function breakLines(ctx, text, maxWidth) {
  const tokens = text.split(' ');
  const lines  = [];
  let cur = '';

  for (const token of tokens) {
    const candidate = cur ? `${cur} ${token}` : token;
    if (ctx.measureText(candidate).width > maxWidth && cur) {
      lines.push(cur);
      cur = token;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function fillWrappedText(ctx, text, x, startY, maxWidth, lineHeight) {
  const lines = breakLines(ctx, text, maxWidth);
  lines.forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineHeight);
  });
}

// =============================================================================
// ④ 글로우 배경 SVG 생성
// =============================================================================

function buildReplyBgSVG(W, H, primary, secondary, tertiary, quaternary) {
  const makeRG = (id, w, h, cx_r, cy_r, rx_r, ry_r, color, stops) => {
    const cx = w * cx_r, cy = h * cy_r;
    const rx = w * rx_r, ry = h * ry_r;
    const r  = Math.max(rx, ry);
    const sx = rx / r, sy = ry / r;

    const stopTags = stops.map(({ pos, alpha }) =>
      `<stop offset="${pos}" stop-color="${color}" stop-opacity="${alpha}"/>`
    ).join('\n      ');

    return `<radialGradient id="${id}"
      gradientUnits="userSpaceOnUse"
      cx="0" cy="0" r="${r.toFixed(2)}"
      gradientTransform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${sx.toFixed(6)},${sy.toFixed(6)})">
      ${stopTags}
    </radialGradient>`;
  };

  const rg1 = makeRG('rg1', W, H, 0.88, 0.08, 0.62, 0.45, tertiary, [
    { pos: 0.00, alpha: 0.18 }, { pos: 0.45, alpha: 0.07 }, { pos: 0.68, alpha: 0.00 },
  ]);
  const rg2 = makeRG('rg2', W, H, 0.12, 0.92, 0.50, 0.38, quaternary, [
    { pos: 0.00, alpha: 0.12 }, { pos: 0.50, alpha: 0.05 }, { pos: 0.62, alpha: 0.00 },
  ]);

  const glowH = Math.round(H * 0.55);
  const rg3 = makeRG('rg3', W, glowH, 0.50, 0.00, 0.85, 0.70, primary, [
    { pos: 0.00, alpha: 0.42 }, { pos: 0.35, alpha: 0.22 }, { pos: 0.70, alpha: 0.00 },
  ]);
  const rg4 = makeRG('rg4', W, glowH, 0.82, 0.00, 0.55, 0.55, secondary, [
    { pos: 0.00, alpha: 0.30 }, { pos: 0.40, alpha: 0.12 }, { pos: 0.68, alpha: 0.00 },
  ]);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>${rg1}${rg2}${rg3}${rg4}</defs>
  <rect width="${W}" height="${H}"    fill="${CFG.BG_CARD}"/>
  <rect width="${W}" height="${H}"    fill="url(#rg1)"/>
  <rect width="${W}" height="${H}"    fill="url(#rg2)"/>
  <rect width="${W}" height="${glowH}" fill="url(#rg3)"/>
  <rect width="${W}" height="${glowH}" fill="url(#rg4)"/>
</svg>`;
}

// =============================================================================
// ⑤ 텍스트 레이어 canvas 생성
// =============================================================================

/**
 * @param {Object}      reply
 * @param {number}      W
 * @param {Object|null} emotionScores
 * @param {string|null} [dominantEmotion]  [v3.1] 서버 결정값
 * @returns {{ buf: Buffer, cardH: number }}
 */
function buildReplyCardBuffer(reply, W, emotionScores = null, dominantEmotion = null) {
  // [v3.1] dominantEmotion 전달
  const fontFamily = resolveFontFamily(emotionScores, dominantEmotion);

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
  const lhTag   = Math.round(fTag      * 1.45);

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
// ⑥ composeCardPNG — 메인 합성 함수
// =============================================================================

/**
 * 정적 경승지 이미지(JPG) 버퍼를 PNG로 리사이즈하고 답글 카드를 합성한다.
 *
 * [v3.1] dominantEmotion 파라미터 추가.
 *
 * @param {Buffer}      imageBuffer
 * @param {string}      outputPath
 * @param {number}      [size=1200]
 * @param {Object|null} [reply]
 * @param {Object|null} [emotionScores]
 * @param {string|null} [dominantEmotion]  [v3.1] 서버 결정값
 * @returns {Promise<string>}
 */
export async function composeCardPNG(
  imageBuffer,
  outputPath,
  size            = CFG.DEFAULT_WIDTH,
  reply           = null,
  emotionScores   = null,
  dominantEmotion = null,   // [v3.1] 추가
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

  // STEP 2: 실제 이미지 크기 확인
  const { width: IW, height: IH } = await sharp(imgBuf).metadata();
  const imgW = IW ?? W;
  const imgH = IH ?? W;

  // STEP 3: 감성 주색 4종 추출
  const colorResult = extractDominantColors(emotionScores);
  const {
    primary    = '#888888',
    secondary  = '#888888',
    tertiary   = '#888888',
    quaternary = '#888888',
  } = colorResult ?? {};

  // STEP 4: 텍스트 캔버스 생성 — [v3.1] dominantEmotion 전달
  const { buf: textBuf, cardH } = buildReplyCardBuffer(reply, imgW, emotionScores, dominantEmotion);

  // STEP 5: 배경+글로우 SVG 래스터라이즈
  const bgSvgStr = buildReplyBgSVG(imgW, cardH, primary, secondary, tertiary, quaternary);
  const bgBuf    = await sharp(Buffer.from(bgSvgStr, 'utf-8'))
    .resize({ width: imgW })
    .png()
    .toBuffer();

  // STEP 6: 최종 합성
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

// =============================================================================
// ⑦ generateCardPNG — 통합 진입점
// =============================================================================

/**
 * 경승지 이미지 읽기 → PNG 변환 → 답글 카드 합성 → 저장.
 *
 * [v3.1] dominantEmotion 파라미터 추가.
 *
 * @param {Object} options
 * @param {Object}      options.emotionScores
 * @param {number}      options.spotIndex        0~11
 * @param {string}      options.outputPath
 * @param {number}      [options.size=1200]
 * @param {Object|null} [options.reply]
 * @param {string|null} [options.dominantEmotion]  [v3.1] 서버 결정값
 * @returns {Promise<string>}
 */
export async function generateCardPNG({
  emotionScores,
  spotIndex,
  outputPath,
  size            = 1200,
  reply           = null,
  dominantEmotion = null,   // [v3.1] 추가
}) {
  const t0 = Date.now();

  if (typeof spotIndex !== 'number' || spotIndex < 0 || spotIndex > 11) {
    throw new Error(`spotIndex가 유효하지 않습니다 (0~11 필요): ${spotIndex}`);
  }

  const { readFile } = await import('fs/promises');
  const idx          = String(spotIndex).padStart(2, '0');
  const imagePath    = new URL(`../assets/scenes/ulsan_scene_${idx}.jpg`, import.meta.url);

  let sceneImageBuf;
  try {
    sceneImageBuf = await readFile(imagePath);
  } catch (err) {
    throw new Error(`경승지 이미지 로드 실패 (ulsan_scene_${idx}.jpg): ${err.message}`);
  }

  // [v3.1] dominantEmotion 전달
  const savedPath = await composeCardPNG(
    sceneImageBuf,
    outputPath,
    size,
    reply,
    emotionScores,
    dominantEmotion,
  );

  console.info(
    `[svg-engine] PNG 생성 완료 | ` +
    `path=${savedPath} | spotIndex=${spotIndex} | size=${size}px | ` +
    `font=${dominantEmotion ?? 'auto'} | ${Date.now() - t0}ms`,
  );

  return savedPath;
}

export default { composeCardPNG, generateCardPNG };
