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
import path                         from 'path';
import { fileURLToPath }            from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 폰트 등록 (모듈 최초 로드 시 1회) ─────────────────────────
let _fontRegistered = false;

function ensureFont() {
  if (_fontRegistered) return;
  const ttfPath = path.resolve(__dirname, '../assets/NanumWaIrDeu.ttf');
  try {
    GlobalFonts.registerFromPath(ttfPath, 'NanumWaIrDeu');
    _fontRegistered = true;
    console.log('[png-exporter] NanumWaIrDeu 폰트 등록 완료');
  } catch (err) {
    console.warn('[png-exporter] 폰트 등록 실패, 시스템 폰트 사용:', err.message);
    _fontRegistered = true; // 재시도 방지
  }
}

// ── 출력 설정 ──────────────────────────────────────────────────
const CFG = Object.freeze({
  DEFAULT_WIDTH:      1200,
  COMPRESSION_LEVEL:  8,
  CARD_RATIO:         0.46,  // 카드 높이 비율 (폰트 전체 확대 반영)
  PAD_X_RATIO:        0.07,
  BG_IMAGE:           '#14110F',
  BG_CARD:            '#1C1710',
  LINE_DIVIDER:       '#3A332C',
  COLOR_ACCENT:       '#C8A84B',
  COLOR_MAIN:         '#F4ECE0',
  COLOR_PLACE:        '#B0A090',
  COLOR_TAGLINE:      '#C8A84B',
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
function buildReplyCardBuffer(reply, W) {
  ensureFont();

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

  dctx.font = `bold ${fMain}px '${CFG.FONT_HAND}'`;
  const mainLines  = breakLines(dctx, reply.main  ?? '', maxTextW);

  dctx.font = `${fPlace}px '${CFG.FONT_HAND}'`;
  const placeLines = breakLines(dctx, reply.place ?? '', maxTextW);

  dctx.font = `${fTag}px '${CFG.FONT_HAND}'`;
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

  // 배경
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
  ctx.font      = `bold ${fMain}px '${CFG.FONT_HAND}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.main ?? '', px, mainY, maxTextW, lhMain);

  // place
  ctx.fillStyle = CFG.COLOR_PLACE;
  ctx.font      = `${fPlace}px '${CFG.FONT_HAND}'`;
  ctx.letterSpacing = '0px';
  fillWrappedText(ctx, reply.place ?? '', px, placeY, maxTextW, lhPlace);

  // tagline
  ctx.fillStyle = CFG.COLOR_TAGLINE;
  ctx.font      = `${fTag}px '${CFG.FONT_HAND}'`;
  ctx.letterSpacing = '2px';
  fillWrappedText(ctx, tagText, px, tagY, maxTextW, lhTag);

  return { buf: canvas.toBuffer('image/png'), cardH: H };
}

// ── 메인 변환 함수 ─────────────────────────────────────────────
export async function svgToPng(
  svgString,
  outputPath,
  size    = CFG.DEFAULT_WIDTH,
  reply   = null,
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
  // 텍스트 길이에 따라 카드 높이가 동적으로 결정된다.
  const { buf: cardBuf, cardH } = buildReplyCardBuffer(reply, imgW);

  // STEP 4: 이미지 + 카드 세로 합성 → 저장
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
    { input: cardBuf, top: imgH, left: 0 },
  ])
  .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
  .toFile(outputPath);

  return outputPath;
}

export default { svgToPng };
