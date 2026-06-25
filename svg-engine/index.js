/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 진입점
 * @module svg-engine
 *
 * 현재 동작 방식 (정적 이미지 기반)
 * ─────────────────────────────────────────────────────────────────
 *
 *   generateCardPNG()가 spotIndex에 해당하는 정적 경승지 이미지
 *   (assets/scenes/ulsan_scene_XX.jpg)를 읽어 PNG 카드를 합성한다.
 *
 *   파이프라인:
 *     ulsan_scene_XX.jpg
 *           ↓
 *     composeCardPNG()   이미지 + 답글 카드 합성 (sharp + @napi-rs/canvas)
 *           ↓
 *     /output/{uuid}.png
 */

'use strict';

import { composeCardPNG,
         generateCardPNG } from './png-exporter.js';

// =============================================================================
// 퍼블릭 API 재노출
// =============================================================================

export { composeCardPNG, generateCardPNG };

// =============================================================================
// Default Export
// =============================================================================

export default { composeCardPNG, generateCardPNG };
