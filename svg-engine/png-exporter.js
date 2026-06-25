/**
 * @fileoverview svg-engine/png-exporter.js
 * @version 4.1.0 — dominantEmotion 외부 확정값 우선 사용
 *
 * 핵심 변경:
 *   dominantEmotion 파라미터를 외부에서 받는 방식 폐기.
 *   buildReplyCardBuffer() 안에서 emotionScores로 직접 dominant를 계산.
 *   외부 파라미터 전달 누락 문제를 구조적으로 제거.
 *
 *   EMOTION_PRIORITY (emotion-fonts.js와 동일 순서) 를 이 파일에 직접 선언.
 *   pickDominantLocal(emotionScores) → dominant 감성 키 반환.
 *   resolveFontFamily(emotionScores) → dominant 감성으로 폰트 결정.
 *
 *   외부 API(composeCardPNG, generateCardPNG) 시그니처는 기존과 동일하게 유지.
 *   (기존 호출부 수정 불필요)
 */

'use strict';

import sharp                         from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdir }                     from 'fs/promises';
import { existsSync }                from 'fs';
import path                          from 'path';
import { fileURLToPath }             from 'url';
import { EMOTION_FONT_MAP,
         FALLBACK_FONT }             from './emotion-fonts.js';
import { extractDominantColors }     from './emotion-colors.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../assets');

// =============================================================================
// ① 폰트 등록
// =============================================================================

let _fontsRegistered = false;
const _availableFonts = new Set();

function ensureFonts() {
  if (_fontsRegistered) return;
  _fontsRegistered = true;

  for (const [emotion, fontInfo] of Object.entries(EMOTION_FONT_MAP)) {
    const ttfPath = path.join(ASSETS_DIR, fontInfo.ttfPath);
    if (!existsSync(ttfPath)) {
      console.warn(`[png-exporter] TTF 없음: ${fontInfo.ttfPath} (${emotion})`);
      continue;
    }
    try {
      GlobalFonts.registerFromPath(ttfPath, fontInfo.family);
      _availableFonts.add(fontInfo.family);
      console.log(`[png-exporter] 폰트 등록: ${fontInfo.family}`);
    } catch (err) {
      console.warn(`[png-exporter] 폰트 등록 실패: ${fontInfo.family}`, err.message);
    }
  }

  console.log(`[png-exporter] 등록된 폰트 (${_availableFonts.size}개): ${[..._availableFonts].join(', ')}`);
}

// =============================================================================
// ② 내부 dominant 결정 — 외부 파라미터 의존 없음
// =============================================================================

/**
 * emotion-fonts.js EMOTION_PRIORITY와 동일 순서.
 * 이 파일 내부에서만 사용. 외부 import 의존성 없음.
 */
const _PRIORITY = [
  'amazement', 'mystery', 'grandeur', 'nostalgia',
  'warmth',    'vitality', 'freshness', 'peace',
];

/**
 * emotionScores에서 dominant 감성 키를 직접 결정한다.
 * 외부에서 값을 전달받지 않고 이 함수가 독립적으로 계산.
 */
function pickDominantLocal(emotionScores) {
  if (!emotionScores || typeof emotionScores !== 'object') return 'amazement';
  let maxVal = -1;
  for (const k of _PRIORITY) {
    const v = Number(emotionScores[k]) || 0;
    if (v > maxVal) maxVal = v;
  }
  const dominant = _PRIORITY.find(k => (Number(emotionScores[k]) || 0) === maxVal) ?? 'amazement';
  console.log(`[png-exporter] dominant 계산: ${dominant} (${maxVal}점)`);
  return dominant;
}

/**
 * emotionScores → dominant 결정 → 폰트 family 반환.
 * TTF 파일이 없으면 등록된 폰트 중 첫 번째 또는 FALLBACK.
 */
function resolveFontFamily(emotionScores) {
  ensureFonts();

  const dominant = pickDominantLocal(emotionScores);
  const fontInfo = EMOTION_FONT_MAP[dominant] ?? FALLBACK_FONT;

  if (_availableFonts.has(fontInfo.family)) {
    console.log(`[png-exporter] 폰트 사용: ${fontInfo.family} (${dominant})`);
    return fontInfo.family;
  }

  // TTF 없음 → FALLBACK_FONT(Nanum Pen Script)로 폴백
  // ※ 첫 번째 등록 폰트(Hahmlet)로 가지 않도록 의도적으로 제거
  if (_availableFonts.has(FALLBACK_FONT.family)) {
    console.warn(`[png-exporter] ${fontInfo.family} 미등록 → ${FALLBACK_FONT.family}(FALLBACK) 사용`);
    return FALLBACK_FONT.family;
  }

  // FALLBACK도 없으면 등록된 폰트 중 첫 번째
  if (_availableFonts.size > 0) {
    const fallback = [..._availableFonts][0];
    console.warn(`[png-exporter] FALLBACK도 미등록 → ${fallback} 사용`);
    return fallback;
  }

  console.warn(`[png-exporter] 등록된 폰트 없음 → FALLBACK family 반환`);
  return FALLBACK_FONT.family;
}

// =============================================================================
// ③ 출력 설정
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
// ④ 유틸
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
  breakLines(ctx, text, maxWidth).forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineHeight);
  });
}

// =============================================================================
// ⑤ 글로우 배경 SVG
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

  // 방사형 빛: rg1 우상단 cy 0.08→0.18 (조금 아래로)
  // 투명도: rg1 0.18→0.32 / rg2 0.12→0.22 / rg3 0.42→0.65 / rg4 0.30→0.50
  const rg1 = makeRG('rg1', W, H, 0.88, 0.50, 0.62, 0.45, tertiary, [
    { pos: 0.00, alpha: 0.32 }, { pos: 0.45, alpha: 0.12 }, { pos: 0.68, alpha: 0.00 },
  ]);
  const rg2 = makeRG('rg2', W, H, 0.12, 0.92, 0.50, 0.38, quaternary, [
    { pos: 0.00, alpha: 0.22 }, { pos: 0.50, alpha: 0.08 }, { pos: 0.62, alpha: 0.00 },
  ]);
  const glowH = Math.round(H * 0.55);
  const rg3 = makeRG('rg3', W, glowH, 0.50, 0.00, 0.85, 0.70, primary, [
    { pos: 0.00, alpha: 0.65 }, { pos: 0.35, alpha: 0.35 }, { pos: 0.70, alpha: 0.00 },
  ]);
  const rg4 = makeRG('rg4', W, glowH, 0.82, 0.00, 0.55, 0.55, secondary, [
    { pos: 0.00, alpha: 0.50 }, { pos: 0.40, alpha: 0.20 }, { pos: 0.68, alpha: 0.00 },
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
// ⑥ 텍스트 레이어 — emotionScores로 직접 폰트 결정
// =============================================================================

function buildReplyCardBuffer(reply, W, emotionScores, dominantEmotion = null) {
  // emotionScores에서 직접 결정 — 외부 파라미터 없음
  // [v4.1 fix] dominantEmotion이 외부에서 확정된 경우 직접 사용, 없으면 emotionScores 재계산
  const fontFamily = (dominantEmotion && EMOTION_FONT_MAP[dominantEmotion])
    ? (() => {
        ensureFonts();
        const fi = EMOTION_FONT_MAP[dominantEmotion];
        const fam = _availableFonts.has(fi.family)          ? fi.family
          : _availableFonts.has(FALLBACK_FONT.family)       ? FALLBACK_FONT.family
          : _availableFonts.size > 0                        ? [..._availableFonts][0]
          : FALLBACK_FONT.family;
        console.log(`[png-exporter] 폰트 결정(확정값): ${fam} (${dominantEmotion})`);
        return fam;
      })()
    : resolveFontFamily(emotionScores);

  const px       = Math.round(W * CFG.PAD_X_RATIO);
  const maxTextW = W - px * 2;

  const fMain  = Math.round(W * 0.0576);
  const fPlace = Math.round(W * 0.0411);
  const fTag   = Math.round(W * 0.0329);

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
// ⑦ composeCardPNG — 기존 시그니처 유지 (호출부 수정 불필요)
// =============================================================================

export async function composeCardPNG(
  imageBuffer,
  outputPath,
  size             = CFG.DEFAULT_WIDTH,
  reply            = null,
  emotionScores    = null,
  dominantEmotion  = null,   // [v4.1 fix] index.js 전달값 수신 — 자체 재계산 우선순위 낮춤
) {
  if (!imageBuffer?.length) throw new Error('imageBuffer가 비어있습니다.');
  if (!outputPath)          throw new Error('outputPath가 없습니다.');

  const W = Math.round(Math.max(400, Math.min(2400, size)));
  await ensureDir(outputPath);

  const imgBuf = await sharp(imageBuffer)
    .resize({ width: W })
    .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
    .toBuffer();

  if (!reply?.main) {
    await sharp(imgBuf).toFile(outputPath);
    return outputPath;
  }

  const { width: IW, height: IH } = await sharp(imgBuf).metadata();
  const imgW = IW ?? W;
  const imgH = IH ?? W;

  const colorResult = extractDominantColors(emotionScores);
  const {
    primary    = '#888888',
    secondary  = '#888888',
    tertiary   = '#888888',
    quaternary = '#888888',
  } = colorResult ?? {};

  // emotionScores를 직접 전달 — buildReplyCardBuffer 내부에서 dominant 결정
  const { buf: textBuf, cardH } = buildReplyCardBuffer(reply, imgW, emotionScores, dominantEmotion);

  const bgSvgStr = buildReplyBgSVG(imgW, cardH, primary, secondary, tertiary, quaternary);
  const bgBuf    = await sharp(Buffer.from(bgSvgStr, 'utf-8'))
    .resize({ width: imgW })
    .png()
    .toBuffer();

  await sharp({
    create: { width: imgW, height: imgH + cardH, channels: 4, background: CFG.BG_IMAGE },
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
// ⑧ generateCardPNG — 기존 시그니처 유지
// =============================================================================

export async function generateCardPNG({
  emotionScores,
  spotIndex,
  outputPath,
  size  = 1200,
  reply = null,
}) {
  const t0 = Date.now();

  if (typeof spotIndex !== 'number' || spotIndex < 0 || spotIndex > 11) {
    throw new Error(`spotIndex 범위 오류: ${spotIndex}`);
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

  const savedPath = await composeCardPNG(sceneImageBuf, outputPath, size, reply, emotionScores, dominantEmotion);

  console.info(
    `[svg-engine] PNG 완료 | spotIndex=${spotIndex} | size=${size}px | ${Date.now() - t0}ms`
  );

  return savedPath;
}

export default { composeCardPNG, generateCardPNG };
