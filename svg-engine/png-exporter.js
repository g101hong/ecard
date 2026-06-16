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
  CARD_RATIO:         0.30,  // 카드 높이 = 이미지 너비 × 이 비율
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

// ── 답글 카드 PNG 버퍼 생성 (@napi-rs/canvas) ─────────────────
function buildReplyCardBuffer(reply, W, H) {
  ensureFont();

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  const px     = Math.round(W * CFG.PAD_X_RATIO);
  const fMain  = Math.round(W * 0.036);
  const fPlace = Math.round(W * 0.020);
  const fTag   = Math.round(W * 0.013);

  // ── 배경 ───────────────────────────────────────────────────
  ctx.fillStyle = CFG.BG_CARD;
  ctx.fillRect(0, 0, W, H);

  // ── 상단 경계선 ────────────────────────────────────────────
  ctx.fillStyle = CFG.LINE_DIVIDER;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 0, W, 1);
  ctx.globalAlpha = 1;

  // ── 황금 구분 단선 ─────────────────────────────────────────
  const lineY = Math.round(H * 0.14);
  const lineW = Math.round(W * 0.05);
  ctx.fillStyle = CFG.COLOR_ACCENT;
  ctx.beginPath();
  ctx.roundRect(px, lineY, lineW, 2, 1);
  ctx.fill();

  // ── main 문장 ─────────────────────────────────────────────
  const mainY = Math.round(H * 0.43);
  ctx.fillStyle = CFG.COLOR_MAIN;
  ctx.font = `bold ${fMain}px '${CFG.FONT_HAND}'`;
  ctx.fillText(reply.main ?? '', px, mainY);

  // ── place 문장 ────────────────────────────────────────────
  const placeY = Math.round(H * 0.64);
  ctx.fillStyle = CFG.COLOR_PLACE;
  ctx.font = `${fPlace}px '${CFG.FONT_HAND}'`;
  ctx.fillText(reply.place ?? '', px, placeY);

  // ── tagline ───────────────────────────────────────────────
  // NanumWaIrDeu에 em dash(—)가 없으므로 하이픈으로 정규화
  const tagY = Math.round(H * 0.85);
  const taglineText = (reply.tagline ?? '').replace(/—/g, '-');
  ctx.fillStyle = CFG.COLOR_TAGLINE;
  ctx.font = `${fTag}px '${CFG.FONT_HAND}'`;
  ctx.letterSpacing = '2px';
  ctx.fillText(taglineText, px, tagY);

  return canvas.toBuffer('image/png');
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
  const cardH   = Math.round(imgW * CFG.CARD_RATIO);
  const cardBuf = buildReplyCardBuffer(reply, imgW, cardH);

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
