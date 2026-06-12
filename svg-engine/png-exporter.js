/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — SVG → PNG 변환 모듈
 * @module svg-engine/png-exporter
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   svg-patcher.js가 반환한 패치된 SVG 문자열을 받아
 *   sharp로 PNG 파일로 변환하고 output/ 디렉터리에 저장한다.
 *
 *   [Phase 1] SVG → PNG 변환 + 기본 후처리
 *     - SVG 문자열 → sharp → PNG 저장
 *     - 출력 크기 제어 (width 지정, 높이 비율 유지)
 *     - PNG 품질 최적화 (compressionLevel, palette 비활성화)
 *
 *   [Phase 2] 타이포그래피 합성 (reply 객체 존재 시)
 *     - SVG를 먼저 PNG로 래스터라이즈
 *     - sharp composite API로 텍스트 오버레이 SVG를 합성
 *     - main(메인 문장) / place(장소 문장) / tagline(ULSAN — ...) 3단 배치
 *     - 나눔손글씨 와일드 폰트 적용 (public/fonts/NanumWild.woff2)
 *       → sharp는 woff2 직접 지원 안 함 → SVG foreignObject 텍스트 오버레이 방식
 *       → 또는 fonttools로 변환된 TTF 사용 시 sharp text composite 가능
 *
 * ─────────────────────────────────────────────────────────────────
 * 파이프라인 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   patchSVG(emotionScores, diversitySeed)   ← svg-patcher.js
 *         │ patchedSvgString
 *         ▼
 *   svgToPng(svgString, outputPath, size, reply)   ← 이 모듈
 *         │
 *         ├── reply 없음 → SVG → PNG 직접 변환
 *         │
 *         └── reply 있음 → SVG → PNG → 텍스트 오버레이 합성
 *         │
 *         ▼
 *   /output/{uuid}.png  (HTTP로 다운로드 제공)
 *
 * ─────────────────────────────────────────────────────────────────
 * 출력 규격
 * ─────────────────────────────────────────────────────────────────
 *
 *   기본 크기  : width 1200px, 높이 비율 유지 (SVG viewBox 기준)
 *   최소 크기  : 400px
 *   최대 크기  : 2400px  (validate.js에서 제한)
 *   포맷       : PNG (투명 배경 유지)
 *   압축       : compressionLevel 8 (파일크기 ↓, 품질 유지)
 *
 * ─────────────────────────────────────────────────────────────────
 * 타이포그래피 3단 레이아웃 (reply 있을 때)
 * ─────────────────────────────────────────────────────────────────
 *
 *   ┌────────────────────────────────────────┐
 *   │                                        │
 *   │   [스테인드글라스 SVG 이미지]           │
 *   │                                        │
 *   ├────────────────────────────────────────┤  ← 이미지 하단 오버레이 영역
 *   │                                        │
 *   │   main    시적 메인 문장 (나눔손글씨)    │  ← 크고 굵게
 *   │   ─────────────────────────            │  ← 구분선
 *   │   place   장소 연결 문장 (소형)         │  ← 중간 크기
 *   │   tagline ULSAN — 태그라인             │  ← 작고 자간 넓게
 *   │                                        │
 *   └────────────────────────────────────────┘
 *
 *   텍스트 오버레이 구현 방식:
 *     SVG <text> / <foreignObject> 요소로 오버레이 SVG를 생성하고
 *     sharp composite()로 PNG 위에 합성한다.
 *     (sharp ^0.33.x — SVG 입력 지원, composite 지원)
 */

'use strict';

import sharp      from 'sharp';
import { mkdir }  from 'fs/promises';
import path       from 'path';

// =============================================================================
// ① 출력 설정 상수
// =============================================================================

const OUTPUT_CONFIG = Object.freeze({
  // PNG 압축 레벨 (0=무압축, 9=최대압축)
  // 8: 파일 크기와 CPU 시간의 균형점 — 관광객 다운로드 속도 고려
  COMPRESSION_LEVEL: 8,

  // 기본 출력 너비 (px) — card.js validate에서 400~2400 범위 보장
  DEFAULT_WIDTH: 1200,

  // 타이포그래피 오버레이 영역 높이 비율 (전체 높이 대비)
  // 예) 1200px 이미지에서 하단 24% = 288px을 텍스트 영역으로 사용
  OVERLAY_HEIGHT_RATIO: 0.24,

  // 오버레이 배경 불투명도 (0~1) — 스테인드글라스가 비쳐 보이도록
  OVERLAY_BG_OPACITY: 0.72,

  // 텍스트 색상
  TEXT_COLOR_MAIN:    '#FFFFFF',   // 메인 문장 — 흰색
  TEXT_COLOR_PLACE:   '#F0EDE8',   // 장소 문장 — 약간 크림
  TEXT_COLOR_TAGLINE: '#C8A84B',   // 태그라인 — 황금빛 (울산대교 sub색 참조)

  // 오버레이 배경색 (어두운 남색 — 스테인드글라스 배경 base색 참조)
  OVERLAY_BG_COLOR: '#0D1218',
});

// =============================================================================
// ② 출력 디렉터리 보장
// =============================================================================

/**
 * 출력 경로의 상위 디렉터리가 존재하지 않으면 생성한다.
 * recursive: true 로 중간 디렉터리도 함께 생성.
 *
 * @param {string} filePath  저장할 파일의 전체 경로
 * @returns {Promise<void>}
 */
async function ensureOutputDir(filePath) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
}

// =============================================================================
// ③ SVG viewBox에서 비율 파싱
// =============================================================================

/**
 * SVG 문자열에서 viewBox 속성을 파싱하여 width/height 비율을 반환한다.
 * viewBox가 없으면 1:1 (정사각형)로 가정한다.
 *
 * sharp는 SVG 입력 시 width를 지정하면 viewBox 비율에 맞게
 * 높이를 자동 계산하므로 이 함수는 디버그·검증용으로만 사용된다.
 *
 * @param {string} svgString
 * @returns {{ width:number, height:number, ratio:number }}
 *
 * @example
 * parseSvgViewBox('<svg viewBox="0 0 500 500">...')
 * // → { width: 500, height: 500, ratio: 1.0 }
 */
function parseSvgViewBox(svgString) {
  const match = svgString.match(/viewBox=["']([^"']+)["']/);
  if (!match) return { width: 500, height: 500, ratio: 1.0 };

  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts[2] <= 0 || parts[3] <= 0) {
    return { width: 500, height: 500, ratio: 1.0 };
  }

  const [, , w, h] = parts;
  return { width: w, height: h, ratio: h / w };
}

// =============================================================================
// ④ 타이포그래피 오버레이 SVG 생성
// =============================================================================

/**
 * reply 3단(main / place / tagline) 텍스트를 SVG 오버레이로 생성한다.
 *
 * [구현 방식]
 *   sharp composite()는 SVG 버퍼를 직접 받을 수 있다.
 *   SVG <text> 요소로 텍스트를 배치하고, <rect>로 반투명 배경을 깐다.
 *   한글 폰트는 SVG font-family 선언 + @font-face 내장 방식으로 처리한다.
 *
 *   나눔손글씨 와일드(NanumWild.woff2)는 public/fonts/ 에 위치.
 *   sharp가 실행되는 서버 환경에서 해당 폰트가 시스템에 설치되어 있지 않을 수 있으므로
 *   SVG 내 <style>에 @font-face로 base64 내장하거나,
 *   폰트가 없을 경우 system 한글 폰트(Noto Sans CJK KR 등)로 폴백한다.
 *   Phase 1에서는 시스템 폰트 폴백 우선 적용하고,
 *   Phase 2에서 NanumWild base64 내장으로 업그레이드한다.
 *
 * [텍스트 크기 전략]
 *   출력 너비(outputWidth)를 기준으로 폰트 크기를 비율로 계산한다.
 *   1200px 기준: main=42px / place=22px / tagline=18px
 *   → 비율: main=3.5%, place=1.83%, tagline=1.5%
 *
 * @param {{
 *   main:    string,
 *   place:   string,
 *   tagline: string,
 * }} reply  E-Card 3단 답글
 * @param {number} outputWidth   최종 PNG 너비 (px)
 * @param {number} outputHeight  최종 PNG 높이 (px)
 * @returns {Buffer}  SVG 오버레이 버퍼
 */
function buildTypographyOverlay(reply, outputWidth, outputHeight) {
  // ── 오버레이 영역 계산 ──────────────────────────────────────────
  const overlayH  = Math.round(outputHeight * OUTPUT_CONFIG.OVERLAY_HEIGHT_RATIO);
  const overlayY  = outputHeight - overlayH;   // 이미지 하단에 위치
  const padX      = Math.round(outputWidth  * 0.06);  // 좌우 패딩 6%
  const textWidth = outputWidth - padX * 2;

  // ── 폰트 크기 (출력 너비 기준 비율) ───────────────────────────
  const fontMain    = Math.round(outputWidth * 0.035);  // ~42px @1200
  const fontPlace   = Math.round(outputWidth * 0.0183); // ~22px @1200
  const fontTagline = Math.round(outputWidth * 0.015);  // ~18px @1200

  // ── 텍스트 Y 좌표 배치 (오버레이 영역 내 상대 좌표) ───────────
  // 구분선 위치: 오버레이 위쪽 35%
  const dividerY  = Math.round(overlayH * 0.35);
  const mainY     = Math.round(overlayH * 0.28);   // 구분선 위
  const placeY    = Math.round(overlayH * 0.57);   // 구분선 아래
  const taglineY  = Math.round(overlayH * 0.80);   // 하단

  // ── 구분선 크기 ───────────────────────────────────────────────
  const dividerW = Math.round(textWidth * 0.20);   // 텍스트 너비의 20%

  // ── XML 이스케이프 ────────────────────────────────────────────
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // ── SVG 생성 ──────────────────────────────────────────────────
  // font-family: 나눔손글씨 와일드를 1순위, 시스템 한글 폰트를 폴백으로
  const fontFamily = [
    'Nanum Wild',          // NanumWild (서버에 설치된 경우)
    'NanumGothic',         // 나눔고딕 폴백
    'Malgun Gothic',       // 맑은 고딕 폴백 (Windows)
    'Apple SD Gothic Neo', // 애플 산돌 폴백 (macOS)
    'Noto Sans CJK KR',    // 노토 산스 CJK (Linux 서버 공통)
    'sans-serif',
  ].join(', ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${outputWidth}" height="${outputHeight}"
     viewBox="0 0 ${outputWidth} ${outputHeight}">

  <!-- 오버레이 배경 (반투명 어두운 그라디언트) -->
  <defs>
    <linearGradient id="overlayGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${OUTPUT_CONFIG.OVERLAY_BG_COLOR}"
            stop-opacity="0"/>
      <stop offset="30%"  stop-color="${OUTPUT_CONFIG.OVERLAY_BG_COLOR}"
            stop-opacity="${OUTPUT_CONFIG.OVERLAY_BG_OPACITY * 0.6}"/>
      <stop offset="100%" stop-color="${OUTPUT_CONFIG.OVERLAY_BG_COLOR}"
            stop-opacity="${OUTPUT_CONFIG.OVERLAY_BG_OPACITY}"/>
    </linearGradient>
  </defs>

  <!-- 그라디언트 오버레이 배경 -->
  <rect x="0" y="${overlayY - Math.round(overlayH * 0.5)}"
        width="${outputWidth}"
        height="${overlayH + Math.round(overlayH * 0.5)}"
        fill="url(#overlayGrad)"/>

  <!-- main: 메인 문장 -->
  <text
    x="${padX}"
    y="${overlayY + mainY}"
    font-family="${fontFamily}"
    font-size="${fontMain}"
    font-weight="bold"
    fill="${OUTPUT_CONFIG.TEXT_COLOR_MAIN}"
    letter-spacing="0.04em"
    text-anchor="start"
    dominant-baseline="auto"
  >${esc(reply.main)}</text>

  <!-- 구분선 -->
  <line
    x1="${padX}" y1="${overlayY + dividerY}"
    x2="${padX + dividerW}" y2="${overlayY + dividerY}"
    stroke="${OUTPUT_CONFIG.TEXT_COLOR_TAGLINE}"
    stroke-width="${Math.max(1, Math.round(outputWidth * 0.0008))}"
    stroke-linecap="round"
    opacity="0.7"
  />

  <!-- place: 장소 연결 문장 -->
  <text
    x="${padX}"
    y="${overlayY + placeY}"
    font-family="${fontFamily}"
    font-size="${fontPlace}"
    font-weight="normal"
    fill="${OUTPUT_CONFIG.TEXT_COLOR_PLACE}"
    letter-spacing="0.02em"
    text-anchor="start"
    dominant-baseline="auto"
    opacity="0.88"
  >${esc(reply.place)}</text>

  <!-- tagline: ULSAN — 태그라인 -->
  <text
    x="${padX}"
    y="${overlayY + taglineY}"
    font-family="${fontFamily}"
    font-size="${fontTagline}"
    font-weight="normal"
    fill="${OUTPUT_CONFIG.TEXT_COLOR_TAGLINE}"
    letter-spacing="0.18em"
    text-anchor="start"
    dominant-baseline="auto"
    opacity="0.90"
  >${esc(reply.tagline)}</text>

</svg>`;

  return Buffer.from(svg, 'utf-8');
}

// =============================================================================
// ⑤ 메인 변환 함수 (퍼블릭 API)
// =============================================================================

/**
 * 패치된 SVG 문자열을 PNG 파일로 변환하여 저장한다.
 *
 * [처리 흐름]
 *   Case A — reply 없음 (단순 이미지 저장):
 *     SVG 버퍼 → sharp().resize(width) → PNG 저장
 *
 *   Case B — reply 있음 (타이포그래피 합성):
 *     SVG 버퍼 → sharp().resize(width) → PNG 래스터라이즈 (메모리)
 *     → 실제 출력 높이 측정 (metadata())
 *     → buildTypographyOverlay()로 텍스트 SVG 생성
 *     → composite([{ input: overlaySvg, top:0, left:0 }])
 *     → PNG 저장
 *
 * [sharp 버전 요구사항]
 *   ^0.33.x (package.json 명시)
 *   - SVG 입력: libvips + librsvg 연동 (Ubuntu 24 기본 포함)
 *   - composite(): SVG/PNG 레이어 합성 지원
 *   - metadata(): 래스터라이즈 후 실제 크기 조회
 *
 * @param {string} svgString    svg-patcher.js 가 반환한 패치된 SVG 문자열
 * @param {string} outputPath   저장할 PNG 파일의 전체 경로
 *                              (예: './output/f47ac10b-58cc-4372.png')
 * @param {number} [size=1200]  출력 이미지 너비 (px) — 높이는 viewBox 비율 유지
 * @param {{ main:string, place:string, tagline:string }|null} [reply]
 *   타이포그래피 합성용 답글 데이터.
 *   null 또는 undefined면 이미지만 저장한다 (Phase 1 기본 동작).
 * @returns {Promise<string>}  저장된 파일의 경로 (outputPath 그대로 반환)
 *
 * @throws {Error}  SVG 파싱 실패 / 디스크 쓰기 실패 / sharp 처리 실패
 *
 * @example
 * // Case A: 이미지만
 * const p = await svgToPng(patchedSvg, './output/card.png', 1200);
 *
 * // Case B: 타이포그래피 합성
 * const p = await svgToPng(patchedSvg, './output/card.png', 1200, {
 *   main:    '간절곶의 빛이 당신을 불렀습니다',
 *   place:   '겨울 새벽, 수평선 너머로 솟는 빛이 당신 눈에 닿은 날',
 *   tagline: 'ULSAN — 빛이 시작되는 곳',
 * });
 */
export async function svgToPng(svgString, outputPath, size = OUTPUT_CONFIG.DEFAULT_WIDTH, reply = null) {
  // ── 입력 검증 ────────────────────────────────────────────────────
  if (typeof svgString !== 'string' || svgString.trim().length === 0) {
    throw new Error('[png-exporter] svgString이 비어있거나 유효하지 않습니다.');
  }
  if (!outputPath) {
    throw new Error('[png-exporter] outputPath가 지정되지 않았습니다.');
  }

  const outputWidth = Math.round(Math.max(400, Math.min(2400, size)));

  // ── 출력 디렉터리 보장 ───────────────────────────────────────────
  await ensureOutputDir(outputPath);

  // ── SVG 버퍼 준비 ────────────────────────────────────────────────
  const svgBuffer = Buffer.from(svgString, 'utf-8');

  // ── Case A: reply 없음 — 단순 변환 ─────────────────────────────
  if (!reply || !reply.main) {
    await sharp(svgBuffer)
      .resize({ width: outputWidth })
      .png({ compressionLevel: OUTPUT_CONFIG.COMPRESSION_LEVEL })
      .toFile(outputPath);

    return outputPath;
  }

  // ── Case B: reply 있음 — 타이포그래피 합성 ───────────────────────

  // STEP B-1: SVG → PNG 래스터라이즈 (메모리, 파일 미저장)
  const rasterBuf = await sharp(svgBuffer)
    .resize({ width: outputWidth })
    .png({ compressionLevel: OUTPUT_CONFIG.COMPRESSION_LEVEL })
    .toBuffer();

  // STEP B-2: 실제 래스터라이즈 크기 조회
  const { width: actualW, height: actualH } = await sharp(rasterBuf).metadata();
  const outputHeight = actualH ?? Math.round(outputWidth * parseSvgViewBox(svgString).ratio);

  // STEP B-3: 텍스트 오버레이 SVG 생성
  const overlaySvgBuf = buildTypographyOverlay(reply, actualW ?? outputWidth, outputHeight);

  // STEP B-4: 래스터 PNG + 오버레이 SVG 합성 → 파일 저장
  await sharp(rasterBuf)
    .composite([{
      input:   overlaySvgBuf,
      top:     0,
      left:    0,
      blend:   'over',   // 알파 블렌딩 — 반투명 오버레이 정확히 합성
    }])
    .png({ compressionLevel: OUTPUT_CONFIG.COMPRESSION_LEVEL })
    .toFile(outputPath);

  return outputPath;
}

// =============================================================================
// ⑥ 유틸리티 — 이미지 메타데이터 조회
// =============================================================================

/**
 * 저장된 PNG 파일의 메타데이터(크기·포맷 등)를 반환한다.
 * server/routes/card.js 에서 응답 JSON에 이미지 크기를 포함할 때 사용 가능.
 *
 * @param {string} filePath
 * @returns {Promise<{ width:number, height:number, format:string, size:number }>}
 *
 * @example
 * const meta = await getPngMetadata('./output/card.png');
 * // → { width:1200, height:1200, format:'png', size:842300 }
 */
export async function getPngMetadata(filePath) {
  const { width, height, format } = await sharp(filePath).metadata();
  const { stat } = await import('fs/promises');
  const { size } = await stat(filePath);
  return { width: width ?? 0, height: height ?? 0, format: format ?? 'png', size };
}

// =============================================================================
// ⑦ 유틸리티 — SVG 문자열 유효성 검사
// =============================================================================

/**
 * SVG 문자열이 최소한의 유효성을 갖추고 있는지 확인한다.
 * sharp에 전달하기 전 빠른 사전 검사용.
 *
 * @param {string} svgString
 * @returns {{ valid:boolean, issues:string[] }}
 *
 * @example
 * validateSvgInput('<svg viewBox="0 0 500 500">...</svg>')
 * // → { valid: true, issues: [] }
 */
export function validateSvgInput(svgString) {
  const issues = [];

  if (typeof svgString !== 'string')       issues.push('svgString이 문자열이 아님');
  if (!svgString?.includes('<svg'))        issues.push('<svg> 태그 없음');
  if (!svgString?.includes('</svg>'))      issues.push('</svg> 닫힘 태그 없음');
  if (!svgString?.includes('viewBox'))     issues.push('viewBox 속성 없음 (렌더링 불안정)');
  if (!svgString?.includes('grad-spot-'))  issues.push('grad-spot- 그라디언트 ID 없음 (패치 미적용 가능성)');

  return { valid: issues.length === 0, issues };
}

// =============================================================================
// ⑧ 디버그 유틸리티
// =============================================================================

/**
 * svgToPng() 처리 결과를 콘솔에 출력한다. (개발 전용)
 *
 * @param {string}  outputPath
 * @param {number}  size
 * @param {boolean} hasReply
 * @param {number}  elapsedMs
 */
export function debugPrintExport(outputPath, size, hasReply, elapsedMs) {
  /* eslint-disable no-console */
  console.group('📸 png-exporter — 변환 결과');
  console.log('출력 경로 :', outputPath);
  console.log('출력 크기 :', `${size}px`);
  console.log('타이포그래피:', hasReply ? '✅ 합성됨' : '❌ 없음 (이미지만)');
  console.log('처리 시간 :', `${elapsedMs}ms`);
  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  svgToPng,
  getPngMetadata,
  validateSvgInput,
  debugPrintExport,
  OUTPUT_CONFIG,
};
