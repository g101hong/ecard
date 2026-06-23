/**
 * @fileoverview 울산 E-Card — 경승지 정적 이미지 표시 모듈
 * @module public/js/scene-image
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 배경
 * ─────────────────────────────────────────────────────────────────
 *
 *   기존 svg-renderer.js는 SVG 패널(spot-XX) ID를 찾아 색상을 직접
 *   패치하는 방식이었으나, 이 방식은 더 이상 사용하지 않는다.
 *
 *   현재 방식: AI가 소감문을 분석해 emotion-engine 인덱스(spotIndex,
 *   0~11)를 산출하면, 그 인덱스에 해당하는 사전 제작된 정적 이미지
 *   파일(ulsan_scene_XX.jpg)을 답글화면 상단에 그대로 표시한다.
 *
 *   파일명의 XX는 emotion-engine spotIndex(0~11)와 1:1로 동일하다.
 *   (SVG의 spot-XX 패널 번호와는 다른 체계이므로 혼동 주의 —
 *    color-engine.js의 SVG_ID_MAP은 이 모듈과 무관하다.)
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine spotIndex ↔ ulsan_scene 파일 매핑]
 *
 *   0  간절곶 일출              → ulsan_scene_00
 *   1  대왕암공원                → ulsan_scene_01
 *   2  강동 몽돌해변             → ulsan_scene_02
 *   3  장생포 고래문화마을       → ulsan_scene_03
 *   4  외고산 옹기마을           → ulsan_scene_04
 *   5  반구대 암각화             → ulsan_scene_05
 *   6  대운산 내원암 계곡        → ulsan_scene_06
 *   7  울산대교                  → ulsan_scene_07
 *   8  울산대공원                → ulsan_scene_08
 *   9  태화강 국가정원·십리대숲  → ulsan_scene_09
 *   10 신불산 억새평원           → ulsan_scene_10
 *   11 가지산 사계               → ulsan_scene_11
 *
 * ─────────────────────────────────────────────────────────────────
 * [공개 API]
 *
 *   showSceneImage(spotIndex)   spotIndex(0~11)에 맞는 이미지를
 *                                #scene-image에 설정 + 블러 해제
 *   resetSceneImage()           이미지 비우고 블러 상태로 복귀
 */

'use strict';

// =============================================================================
// ① 설정 상수
// =============================================================================

const SCENE_CONFIG = Object.freeze({
  /** 이미지가 위치한 디렉토리 (서버 정적 서빙 경로) */
  IMAGE_DIR: '/assets/scenes',

  /** 파일 확장자 — 실제 업로드된 파일 형식에 맞게 조정 */
  EXTENSION: 'jpg',

  /** <img> 엘리먼트 ID */
  IMAGE_ID: 'scene-image',

  /** 블러 상태를 나타내는 CSS 클래스 (animations.css와 공유) */
  BLURRED_CLASS: 'blurred',
});

/** emotion-engine spotIndex(0~11) → 경승지 한글명 (디버그/접근성용) */
export const SCENE_NAMES = [
  '간절곶 일출', '대왕암공원', '강동 몽돌해변', '장생포 고래문화마을',
  '외고산 옹기마을', '반구대 암각화', '대운산 내원암 계곡', '울산대교',
  '울산대공원', '태화강 국가정원·십리대숲', '신불산 억새평원', '가지산 사계',
];

// =============================================================================
// ② DOM 헬퍼
// =============================================================================

function _img() {
  return document.getElementById(SCENE_CONFIG.IMAGE_ID);
}

/**
 * spotIndex(0~11)로 이미지 파일 경로를 생성한다.
 * @param {number} spotIndex
 * @returns {string}
 */
function _buildImagePath(spotIndex) {
  const idx = String(spotIndex).padStart(2, '0');
  return `${SCENE_CONFIG.IMAGE_DIR}/ulsan_scene_${idx}.${SCENE_CONFIG.EXTENSION}`;
}

// =============================================================================
// ③ 퍼블릭 API
// =============================================================================

/**
 * AI 분석 결과의 spotIndex(emotion-engine 인덱스, 0~11)에 해당하는
 * 정적 경승지 이미지를 #scene-image에 표시하고 블러를 해제한다.
 *
 * 이미지 로드가 끝난 뒤에 블러를 해제해야 "블러된 placeholder가
 * 새 이미지로 순간 전환되는" 어색함 없이 자연스러운 reveal 연출이 된다.
 *
 * @param {number} spotIndex  0~11 (emotion-engine 인덱스)
 * @returns {Promise<void>}
 *
 * @example
 * onColors: (colorsData) => {
 *   showSceneImage(colorsData.spotIndex);
 * }
 */
export function showSceneImage(spotIndex) {
  const el = _img();
  if (!el) {
    console.warn('[scene-image] #scene-image 요소를 찾을 수 없습니다.');
    return Promise.resolve();
  }

  const idx = Number(spotIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 11) {
    console.warn('[scene-image] 잘못된 spotIndex:', spotIndex);
    return Promise.resolve();
  }

  const src  = _buildImagePath(idx);
  const name = SCENE_NAMES[idx] ?? `경승지 ${idx}`;

  return new Promise((resolve) => {
    // 블러 상태 유지한 채 새 이미지를 미리 로드 (깜빡임 방지)
    const preloader = new Image();
    preloader.onload = () => {
      el.src = src;
      el.alt = `울산 12경 — ${name}`;
      // reveal은 호출부(app.js)에서 별도로 트리거 (revealSceneImage)
      resolve();
    };
    preloader.onerror = () => {
      console.warn('[scene-image] 이미지 로드 실패:', src);
      el.src = src; // 실패해도 src는 설정 (alt 텍스트 표시되도록)
      el.alt = name;
      resolve();
    };
    preloader.src = src;
  });
}

/**
 * #scene-image의 블러를 해제한다 (CSS transition).
 * showSceneImage()로 이미지가 설정된 뒤 호출한다.
 *
 * @example
 * await showSceneImage(spotIndex);
 * revealSceneImage();
 */
export function revealSceneImage() {
  const el = _img();
  if (!el) return;
  el.classList.remove(SCENE_CONFIG.BLURRED_CLASS);
}

/**
 * "다시 쓰기" 시 이미지를 초기화하고 블러 상태로 되돌린다.
 *
 * @example
 * resetSceneImage();
 */
export function resetSceneImage() {
  const el = _img();
  if (!el) return;
  el.src = '';
  el.alt = '울산 12경';
  el.classList.add(SCENE_CONFIG.BLURRED_CLASS);
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  showSceneImage,
  revealSceneImage,
  resetSceneImage,
  SCENE_NAMES,
};
