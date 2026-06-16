/**
 * @fileoverview svg-engine/png-exporter.js
 * @description  SVG → PNG 변환 + 답글 카드 합성
 *
 * 레이아웃:
 *   ┌──────────────────────┐
 *   │  스테인드글라스 이미지  │  (정사각형, outputWidth × outputWidth)
 *   ├──────────────────────┤
 *   │  답글 카드 영역        │  (outputWidth × CARD_HEIGHT_RATIO)
 *   │   ─────              │  (구분선)
 *   │   main 문장           │  (Noto Serif CJK KR Bold)
 *   │   place 문장          │  (Noto Serif CJK KR)
 *   │   ULSAN tagline       │  (Noto Sans CJK KR, 금색)
 *   └──────────────────────┘
 *
 * 폰트: Noto Serif/Sans CJK KR (서버 시스템 폰트, librsvg 경유)
 */

'use strict';

import sharp     from 'sharp';
import { mkdir } from 'fs/promises';
import path      from 'path';

// ── 출력 설정 ──────────────────────────────────────────────────
const CFG = Object.freeze({
  DEFAULT_WIDTH:        1200,
  COMPRESSION_LEVEL:    8,
  CARD_HEIGHT_RATIO:    0.30,   // 이미지 너비 대비 카드 영역 높이 비율
  PAD_X_RATIO:          0.07,   // 좌우 패딩 비율
  BG_IMAGE:             '#14110F',  // 이미지 배경 (최외곽)
  BG_CARD:              '#1C1710',  // 답글 카드 배경
  LINE_COLOR:           '#3A332C',  // 카드 상단 구분선
  COLOR_MAIN:           '#F4ECE0',  // main 문장색
  COLOR_PLACE:          '#B0A090',  // place 문장색
  COLOR_TAGLINE:        '#C8A84B',  // tagline 금색
  FONT_SERIF:           'Noto Serif CJK KR',
  FONT_SANS:            'Noto Sans CJK KR',
});

// ── 유틸 ──────────────────────────────────────────────────────
async function ensureDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseSvgRatio(svgString) {
  const m = svgString.match(/viewBox=["']([^"']+)["']/);
  if (!m) return 1.0;
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  return (p.length >= 4 && p[2] > 0 && p[3] > 0) ? p[3] / p[2] : 1.0;
}

// ── 답글 카드 SVG 생성 ─────────────────────────────────────────
function buildReplyCard(reply, W, H) {
  const px    = Math.round(W * CFG.PAD_X_RATIO);
  const fMain = Math.round(W * 0.036);
  const fPl   = Math.round(W * 0.020);
  const fTag  = Math.round(W * 0.013);

  // 구분선: 카드 상단 12%
  const lineY  = Math.round(H * 0.14);
  const lineW  = Math.round(W * 0.05);

  // 텍스트 Y (baseline)
  const mainY  = Math.round(H * 0.43);
  const placeY = Math.round(H * 0.64);
  const tagY   = Math.round(H * 0.85);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <!-- 배경 -->
  <rect width="${W}" height="${H}" fill="${CFG.BG_CARD}"/>
  <!-- 상단 경계선 -->
  <rect width="${W}" height="1" fill="${CFG.LINE_COLOR}" opacity="0.6"/>
  <!-- 황금 구분 단선 -->
  <rect x="${px}" y="${lineY}" width="${lineW}" height="2" fill="${CFG.COLOR_TAGLINE}" rx="1"/>
  <!-- main -->
  <text x="${px}" y="${mainY}"
    font-family="${CFG.FONT_SERIF}" font-size="${fMain}"
    font-weight="bold" fill="${CFG.COLOR_MAIN}"
  >${esc(reply.main)}</text>
  <!-- place -->
  <text x="${px}" y="${placeY}"
    font-family="${CFG.FONT_SERIF}" font-size="${fPl}"
    fill="${CFG.COLOR_PLACE}"
  >${esc(reply.place)}</text>
  <!-- tagline -->
  <text x="${px}" y="${tagY}"
    font-family="${CFG.FONT_SANS}" font-size="${fTag}"
    fill="${CFG.COLOR_TAGLINE}" letter-spacing="3"
  >${esc(reply.tagline)}</text>
</svg>`;
}

// ── 메인 변환 함수 ─────────────────────────────────────────────
export async function svgToPng(
  svgString,
  outputPath,
  size = CFG.DEFAULT_WIDTH,
  reply = null,
) {
  if (!svgString?.trim()) throw new Error('svgString이 비어있습니다.');
  if (!outputPath)        throw new Error('outputPath가 없습니다.');

  const W = Math.round(Math.max(400, Math.min(2400, size)));
  await ensureDir(outputPath);

  const svgBuf = Buffer.from(svgString, 'utf-8');

  // ── reply 없음: 이미지만 저장 ───────────────────────────────
  if (!reply?.main) {
    await sharp(svgBuf)
      .resize({ width: W })
      .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
      .toFile(outputPath);
    return outputPath;
  }

  // ── reply 있음: 이미지 + 답글 카드 세로 합성 ─────────────────

  // STEP 1: SVG → PNG 래스터라이즈
  const imgBuf = await sharp(svgBuf)
    .resize({ width: W })
    .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
    .toBuffer();

  // STEP 2: 실제 이미지 높이 확인
  const { width: imgW, height: imgH } = await sharp(imgBuf).metadata();
  const IW = imgW ?? W;
  const IH = imgH ?? Math.round(W * parseSvgRatio(svgString));

  // STEP 3: 답글 카드 생성
  const cardH   = Math.round(IW * CFG.CARD_HEIGHT_RATIO);
  const cardSvg = buildReplyCard(reply, IW, cardH);
  const cardBuf = await sharp(Buffer.from(cardSvg, 'utf-8'))
    .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
    .toBuffer();

  // STEP 4: 전체 캔버스(이미지 + 카드) 합성 → 저장
  await sharp({
    create: {
      width:      IW,
      height:     IH + cardH,
      channels:   4,
      background: CFG.BG_IMAGE,
    },
  })
  .composite([
    { input: imgBuf,  top: 0,  left: 0 },
    { input: cardBuf, top: IH, left: 0 },
  ])
  .png({ compressionLevel: CFG.COMPRESSION_LEVEL })
  .toFile(outputPath);

  return outputPath;
}

export default { svgToPng };
