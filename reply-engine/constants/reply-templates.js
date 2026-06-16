/**
 * @fileoverview 울산 E-Card 답글 엔진 — 폴백 답글 템플릿 풀
 * @module reply-engine/constants/reply-templates
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   reply-fallback.js가 API 실패 시 참조하는 사전 작성 답글 풀.
 *
 *   "어떤 상황에서도 방문객에게는 반드시 답글을 전달한다."
 *
 *   템플릿 선택 우선순위:
 *     1. 지배 감성(dominantEmotion) + 계절(season) 조합
 *     2. 지배 감성만 단독 매칭
 *     3. 계절만 단독 매칭
 *     4. 공통 폴백 (모든 조합 실패 시)
 *
 * ─────────────────────────────────────────────────────────────────
 * [템플릿 구조]
 *
 *   각 답글은 E-Card 3단 구조에 맞춰 구성된다:
 *
 *   main     메인 문장   12~20자, 시적이고 여운 있게
 *   place    장소 문장   계절·시간 맥락 연결, 1~2줄
 *   tagline  태그라인    "ULSAN — [4~8자]" 고정 형식
 *
 * ─────────────────────────────────────────────────────────────────
 * [감성 키값]
 *
 *   emotion-engine/ai-extractor.js의 dominantEmotion과 동일:
 *   amazement | peace | vitality | nostalgia |
 *   freshness | grandeur | warmth | mystery
 *
 * ─────────────────────────────────────────────────────────────────
 * [계절 키값]
 *
 *   solar-terms.js의 season과 동일:
 *   spring | summer | autumn | winter
 *
 * ─────────────────────────────────────────────────────────────────
 * [다양성 확보]
 *
 *   각 조합마다 3개 이상의 변형을 제공한다.
 *   reply-fallback.js가 diversitySeed로 하나를 선택하므로
 *   같은 감성+계절이라도 매번 다른 문장이 나온다.
 */
 
'use strict';
 
// =============================================================================
// ① 감성 × 계절 조합 템플릿
// =============================================================================
 
/**
 * 8감성 × 4계절 = 32개 조합 템플릿.
 * 각 조합마다 3개 변형을 제공한다.
 *
 * 키 형식: `${dominantEmotion}_${season}`
 */
export const EMOTION_SEASON_TEMPLATES = {
 
  // ════════════════════════════════════════════════════════════════
  // amazement (경이·감탄)
  // ════════════════════════════════════════════════════════════════
 
  amazement_spring: [
    {
      main:    '봄의 울산이 당신을 압도한 날',
      place:   '꽃이 피고 빛이 넘치는 그 순간, 울산이 당신에게 전부를 보여주었습니다.',
      tagline: 'ULSAN — 눈이 머무는 곳',
    },
    {
      main:    '그 경이로움, 봄이 빚어낸 것입니다',
      place:   '울산의 봄은 말보다 먼저 마음에 닿습니다.',
      tagline: 'ULSAN — 봄빛이 시작되는 곳',
    },
    {
      main:    '울산의 봄이 당신 앞에 펼쳐진 날',
      place:   '이 경이로움은 오직 이 계절, 이 순간에만 존재합니다.',
      tagline: 'ULSAN — 다시 오고 싶은 곳',
    },
  ],
 
  amazement_summer: [
    {
      main:    '여름 울산이 당신의 눈을 빼앗은 날',
      place:   '뜨겁고 선명한 여름, 울산은 가장 강렬하게 빛납니다.',
      tagline: 'ULSAN — 눈부신 여름의 도시',
    },
    {
      main:    '말이 사라진 자리에 울산이 있었습니다',
      place:   '여름 울산이 당신에게 건넨 압도적인 순간.',
      tagline: 'ULSAN — 말이 필요 없는 곳',
    },
    {
      main:    '이 장관, 여름 울산만이 줄 수 있습니다',
      place:   '뜨거운 계절, 울산은 그 모든 것으로 당신을 맞이했습니다.',
      tagline: 'ULSAN — 가장 뜨거운 여름',
    },
  ],
 
  amazement_autumn: [
    {
      main:    '가을 울산이 당신 앞에 쏟아진 날',
      place:   '황금빛 계절, 울산은 가장 풍성하게 빛났습니다.',
      tagline: 'ULSAN — 황금빛 경이의 도시',
    },
    {
      main:    '그 장관은 가을이 울산에 남긴 선물',
      place:   '울산의 가을은 해마다 새로운 경이로움을 만들어냅니다.',
      tagline: 'ULSAN — 가을이 머무는 곳',
    },
    {
      main:    '눈을 의심한 그 순간, 울산의 가을이었습니다',
      place:   '이 계절의 울산은 당신의 기억 속에 오래 남을 것입니다.',
      tagline: 'ULSAN — 기억에 새겨지는 곳',
    },
  ],
 
  amazement_winter: [
    {
      main:    '겨울 울산이 당신을 압도한 순간',
      place:   '차갑고 선명한 겨울 빛 아래, 울산은 가장 극적으로 빛납니다.',
      tagline: 'ULSAN — 겨울이 만든 경이',
    },
    {
      main:    '그 고요한 장관, 겨울 울산이 선물한 것',
      place:   '겨울의 차가움 속에서 울산은 더 선명해집니다.',
      tagline: 'ULSAN — 선명한 겨울의 도시',
    },
    {
      main:    '이 경이로움 앞에 겨울도 잠시 멈췄습니다',
      place:   '울산의 겨울은 고요하지만, 언제나 깊은 감동을 품고 있습니다.',
      tagline: 'ULSAN — 깊이가 있는 곳',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // peace (고요·평화)
  // ════════════════════════════════════════════════════════════════
 
  peace_spring: [
    {
      main:    '봄의 울산이 당신을 쉬게 한 날',
      place:   '꽃향기와 따뜻한 햇살, 울산의 봄이 마음을 어루만졌습니다.',
      tagline: 'ULSAN — 쉬어가는 봄의 도시',
    },
    {
      main:    '그 고요함, 봄볕 아래 울산이 드린 것',
      place:   '봄 울산의 잔잔한 공기가 당신의 하루를 부드럽게 채웠습니다.',
      tagline: 'ULSAN — 봄이 머무는 곳',
    },
    {
      main:    '울산의 봄 한낮이 당신을 안아준 날',
      place:   '이 고요한 평화는 울산이 봄마다 당신에게 건네는 인사입니다.',
      tagline: 'ULSAN — 평화가 피어나는 곳',
    },
  ],
 
  peace_summer: [
    {
      main:    '뜨거운 여름 속 울산의 고요를 만난 날',
      place:   '초록이 짙어진 울산, 여름의 소란 속에서도 고요한 자리가 있었습니다.',
      tagline: 'ULSAN — 여름의 쉼터',
    },
    {
      main:    '여름 울산이 당신에게 건넨 잠깐의 평화',
      place:   '뜨거운 계절에도 울산은 늘 쉬어갈 자리를 마련해둡니다.',
      tagline: 'ULSAN — 쉬어가는 곳',
    },
    {
      main:    '그 그늘 아래, 여름 울산이 기다리고 있었습니다',
      place:   '울산의 여름은 활기차지만, 고요한 쉼도 함께 품고 있습니다.',
      tagline: 'ULSAN — 그늘이 있는 도시',
    },
  ],
 
  peace_autumn: [
    {
      main:    '가을 울산의 고요가 잠시 당신 것이었습니다',
      place:   '낙엽이 내려앉는 소리만이 가득한 울산의 가을.',
      tagline: 'ULSAN — 가을 고요의 도시',
    },
    {
      main:    '그 평화로운 가을 오후, 울산이 함께였습니다',
      place:   '황금빛 계절의 울산은 마음을 조용히 채워줍니다.',
      tagline: 'ULSAN — 마음이 쉬는 곳',
    },
    {
      main:    '울산의 가을이 당신 마음에 깃든 날',
      place:   '서늘하고 맑은 가을 공기 속, 울산은 당신에게 고요를 선물했습니다.',
      tagline: 'ULSAN — 고요가 깃드는 곳',
    },
  ],
 
  peace_winter: [
    {
      main:    '겨울 울산의 고요가 당신 곁에 머문 날',
      place:   '차갑고 고요한 겨울, 울산은 가장 조용한 목소리로 말을 건넵니다.',
      tagline: 'ULSAN — 겨울 고요의 도시',
    },
    {
      main:    '이 고요함은 겨울 울산이 건네는 선물입니다',
      place:   '차가운 계절일수록 울산의 고요는 더 깊어집니다.',
      tagline: 'ULSAN — 고요가 깊어지는 곳',
    },
    {
      main:    '겨울의 울산 앞에서 마음이 조용해졌습니다',
      place:   '울산의 겨울은 말없이, 그러나 깊이 당신을 안아줍니다.',
      tagline: 'ULSAN — 말없이 품어주는 곳',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // vitality (활기·생동)
  // ════════════════════════════════════════════════════════════════
 
  vitality_spring: [
    {
      main:    '봄 울산의 에너지가 당신을 깨운 날',
      place:   '새 생명이 솟아오르는 울산의 봄, 그 생동감이 당신에게 닿았습니다.',
      tagline: 'ULSAN — 봄 에너지의 도시',
    },
    {
      main:    '그 설렘, 울산의 봄이 만들어낸 것입니다',
      place:   '싹이 트고 꽃이 피는 울산의 봄은 언제나 활기로 가득합니다.',
      tagline: 'ULSAN — 생동이 시작되는 곳',
    },
    {
      main:    '봄 울산의 생동감이 함께한 하루였습니다',
      place:   '울산의 봄은 가만히 있어도 몸과 마음에 힘을 불어넣습니다.',
      tagline: 'ULSAN — 활기가 피어나는 곳',
    },
  ],
 
  vitality_summer: [
    {
      main:    '여름 울산의 에너지가 온몸에 닿은 날',
      place:   '뜨거운 여름, 울산은 그 열기만큼 강렬하고 생동감이 넘칩니다.',
      tagline: 'ULSAN — 뜨거운 여름의 도시',
    },
    {
      main:    '이 활기, 여름 울산이 아니면 느낄 수 없습니다',
      place:   '파도와 바람, 여름의 울산은 살아있음을 온몸으로 알려줍니다.',
      tagline: 'ULSAN — 살아있는 여름',
    },
    {
      main:    '여름 울산과 함께한 에너지 넘치는 하루',
      place:   '울산의 여름은 당신의 심장을 더 빠르게 뛰게 합니다.',
      tagline: 'ULSAN — 여름이 가장 뜨거운 곳',
    },
  ],
 
  vitality_autumn: [
    {
      main:    '가을 울산의 활기가 함께한 날',
      place:   '황금빛 계절의 울산은 풍성하고 생동감 있게 빛납니다.',
      tagline: 'ULSAN — 풍요로운 가을 도시',
    },
    {
      main:    '그 에너지는 가을 울산이 건넨 선물입니다',
      place:   '서늘한 공기와 선명한 색채, 가을 울산은 감각을 깨웁니다.',
      tagline: 'ULSAN — 감각이 깨어나는 곳',
    },
    {
      main:    '가을 울산과 함께 살아있음을 느낀 하루',
      place:   '울산의 가을은 보는 것만으로도 에너지가 차오릅니다.',
      tagline: 'ULSAN — 가을이 충만한 곳',
    },
  ],
 
  vitality_winter: [
    {
      main:    '겨울 울산의 찬 바람이 당신을 깨운 날',
      place:   '매서운 바람도 울산과 함께라면 활기가 됩니다.',
      tagline: 'ULSAN — 겨울도 활기찬 도시',
    },
    {
      main:    '차가운 겨울 울산이 오히려 에너지를 준 날',
      place:   '겨울의 울산은 선명하고 힘차게 당신을 맞이합니다.',
      tagline: 'ULSAN — 선명한 겨울 에너지',
    },
    {
      main:    '겨울 울산의 생동감이 함께한 하루였습니다',
      place:   '차갑고 맑은 겨울 울산, 그 속에서 새로운 에너지를 발견했습니다.',
      tagline: 'ULSAN — 겨울의 활기',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // nostalgia (그리움·향수)
  // ════════════════════════════════════════════════════════════════
 
  nostalgia_spring: [
    {
      main:    '봄 울산이 오래된 기억을 꺼내든 날',
      place:   '꽃이 피고 새가 우는 봄, 울산이 잊었던 것들을 떠올리게 했습니다.',
      tagline: 'ULSAN — 그리움이 피어나는 곳',
    },
    {
      main:    '그 그리움, 울산의 봄이 건드린 것입니다',
      place:   '봄 울산의 향기는 마음속 어딘가에 오래 남아 있던 기억을 깨웁니다.',
      tagline: 'ULSAN — 기억이 살아나는 곳',
    },
    {
      main:    '봄 울산 앞에서 그리운 것들이 떠올랐습니다',
      place:   '울산의 봄은 새롭지만, 어딘지 모르게 오래전부터 알던 것 같습니다.',
      tagline: 'ULSAN — 봄마다 돌아오는 곳',
    },
  ],
 
  nostalgia_summer: [
    {
      main:    '여름 울산이 오래된 기억을 데려온 날',
      place:   '뜨거운 여름 햇살, 파도 소리가 오래전 그 여름을 불러옵니다.',
      tagline: 'ULSAN — 여름 기억의 도시',
    },
    {
      main:    '그 여름의 기억, 울산이 다시 꺼내주었습니다',
      place:   '울산의 여름은 언제나 오래된 추억과 함께 찾아옵니다.',
      tagline: 'ULSAN — 추억이 되살아나는 곳',
    },
    {
      main:    '여름 울산 앞에서 그때가 생각났습니다',
      place:   '바다와 바람, 여름 울산은 그리운 것들을 가득 품고 있습니다.',
      tagline: 'ULSAN — 그립고 좋은 곳',
    },
  ],
 
  nostalgia_autumn: [
    {
      main:    '가을 울산이 그리운 것들을 불러온 날',
      place:   '낙엽이 지는 가을, 울산은 아름다운 것들이 지나가는 자리를 보여줍니다.',
      tagline: 'ULSAN — 가을 향수의 도시',
    },
    {
      main:    '오래 기억될 울산의 가을 한 장면',
      place:   '황금빛 계절의 울산은 그 자체로 그리움이 됩니다.',
      tagline: 'ULSAN — 그리움이 되는 곳',
    },
    {
      main:    '가을 울산은 언제나 다시 오고 싶게 합니다',
      place:   '울산의 가을이 남긴 여운은 오래도록 마음에 머뭅니다.',
      tagline: 'ULSAN — 자꾸 생각나는 곳',
    },
  ],
 
  nostalgia_winter: [
    {
      main:    '겨울 울산이 그리운 것들을 데려온 날',
      place:   '차가운 겨울, 울산은 따뜻했던 기억들을 더 선명하게 만듭니다.',
      tagline: 'ULSAN — 겨울 그리움의 도시',
    },
    {
      main:    '그 겨울의 기억, 울산이 함께였습니다',
      place:   '차갑고 고요한 겨울 울산 앞에서 그리운 것들이 떠올랐습니다.',
      tagline: 'ULSAN — 기억이 깊어지는 곳',
    },
    {
      main:    '겨울 울산은 오래 기억될 것 같았습니다',
      place:   '울산의 겨울은 지나가고 나서야 더 그리워지는 것들로 가득합니다.',
      tagline: 'ULSAN — 지나고 나서 그리운 곳',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // freshness (청량·신선)
  // ════════════════════════════════════════════════════════════════
 
  freshness_spring: [
    {
      main:    '봄 울산의 맑은 공기가 당신을 채운 날',
      place:   '새 계절의 신선한 바람, 울산의 봄 공기가 마음까지 맑게 해주었습니다.',
      tagline: 'ULSAN — 봄 청량의 도시',
    },
    {
      main:    '그 상쾌함, 봄 울산이 건네준 것입니다',
      place:   '봄 울산의 공기는 한 모금으로 온몸이 개운해집니다.',
      tagline: 'ULSAN — 공기가 맑은 곳',
    },
    {
      main:    '봄 울산의 청량함이 하루를 가득 채웠습니다',
      place:   '울산의 봄 바람은 막힌 것을 모두 뚫어주는 힘이 있습니다.',
      tagline: 'ULSAN — 봄바람이 부는 곳',
    },
  ],
 
  freshness_summer: [
    {
      main:    '여름 울산의 시원함이 온몸에 닿은 날',
      place:   '뜨거운 여름이지만, 울산의 바다 바람은 늘 시원하게 불어옵니다.',
      tagline: 'ULSAN — 시원한 여름 바람',
    },
    {
      main:    '그 청량함, 여름 울산 바다가 선물한 것',
      place:   '파도와 해풍이 여름 울산을 언제나 신선하게 만들어줍니다.',
      tagline: 'ULSAN — 바다 바람의 도시',
    },
    {
      main:    '여름 울산의 바람이 기억에 남았습니다',
      place:   '뜨거운 계절에도 울산의 바람은 언제나 시원하고 맑습니다.',
      tagline: 'ULSAN — 늘 시원한 곳',
    },
  ],
 
  freshness_autumn: [
    {
      main:    '가을 울산의 서늘한 공기가 당신을 깨운 날',
      place:   '서늘하고 투명한 가을 공기, 울산은 이 계절에 가장 맑습니다.',
      tagline: 'ULSAN — 가을 청명의 도시',
    },
    {
      main:    '그 청량함은 가을 울산만이 줄 수 있습니다',
      place:   '높고 맑은 하늘, 가을 울산의 공기는 모든 것을 선명하게 합니다.',
      tagline: 'ULSAN — 가장 맑은 계절',
    },
    {
      main:    '가을 울산의 맑은 공기, 오래 기억될 것 같습니다',
      place:   '서늘한 가을 울산은 몸도 마음도 가볍게 만들어줍니다.',
      tagline: 'ULSAN — 가벼워지는 곳',
    },
  ],
 
  freshness_winter: [
    {
      main:    '겨울 울산의 차갑고 맑은 공기를 마신 날',
      place:   '차갑지만 투명한 겨울 울산의 공기는 폐부까지 깨끗하게 합니다.',
      tagline: 'ULSAN — 겨울 청량의 도시',
    },
    {
      main:    '그 맑음, 겨울 울산이 아니면 없는 것입니다',
      place:   '겨울의 차가운 공기가 울산을 가장 선명하게 만들어줍니다.',
      tagline: 'ULSAN — 겨울이 맑은 도시',
    },
    {
      main:    '겨울 울산의 공기가 온몸을 깨웠습니다',
      place:   '차갑고 맑은 울산의 겨울, 그 청량함은 오래 기억됩니다.',
      tagline: 'ULSAN — 선명하게 기억되는 곳',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // grandeur (웅장·장엄)
  // ════════════════════════════════════════════════════════════════
 
  grandeur_spring: [
    {
      main:    '봄 울산의 웅장함 앞에 작아진 날',
      place:   '꽃이 피고 생명이 넘치는 봄, 울산의 스케일은 언제나 경외롭습니다.',
      tagline: 'ULSAN — 봄의 장대한 도시',
    },
    {
      main:    '그 장엄함, 봄 울산이 품고 있던 것',
      place:   '울산의 봄은 화사하지만, 그 안에 담긴 스케일은 압도적입니다.',
      tagline: 'ULSAN — 스케일이 다른 곳',
    },
    {
      main:    '봄 울산의 거대함이 마음을 가득 채웠습니다',
      place:   '울산의 봄 앞에서는 그저 작아지는 것이 자연스럽습니다.',
      tagline: 'ULSAN — 크고 깊은 봄',
    },
  ],
 
  grandeur_summer: [
    {
      main:    '여름 울산의 웅장함이 온몸을 압도한 날',
      place:   '뜨겁고 거대한 여름, 울산은 그 스케일로 당신을 압도합니다.',
      tagline: 'ULSAN — 웅장한 여름의 도시',
    },
    {
      main:    '이 장엄함은 여름 울산만이 보여줄 수 있습니다',
      place:   '여름의 강렬한 빛 아래, 울산의 거대함은 더욱 두드러집니다.',
      tagline: 'ULSAN — 여름의 장대함',
    },
    {
      main:    '여름 울산 앞에서 말을 잃었습니다',
      place:   '이 도시의 스케일은 여름이 되면 더 크고 웅장하게 느껴집니다.',
      tagline: 'ULSAN — 말을 잃게 하는 곳',
    },
  ],
 
  grandeur_autumn: [
    {
      main:    '가을 울산의 장엄함이 마음을 흔든 날',
      place:   '황금빛으로 물든 거대한 울산의 가을, 그 앞에 서면 절로 숙연해집니다.',
      tagline: 'ULSAN — 가을의 장엄함',
    },
    {
      main:    '이 웅장함은 가을 울산만이 선물할 수 있습니다',
      place:   '가을 울산의 광활한 풍경은 시간마저 멈추게 합니다.',
      tagline: 'ULSAN — 광활한 가을 도시',
    },
    {
      main:    '가을 울산의 스케일 앞에서 작아졌습니다',
      place:   '울산의 가을은 그 거대함으로 당신을 한없이 겸손하게 합니다.',
      tagline: 'ULSAN — 크고 깊은 가을',
    },
  ],
 
  grandeur_winter: [
    {
      main:    '겨울 울산의 장엄함이 당신을 멈추게 한 날',
      place:   '차갑고 고요한 겨울, 울산의 웅장함은 더욱 선명하게 드러납니다.',
      tagline: 'ULSAN — 겨울의 장엄한 도시',
    },
    {
      main:    '이 장엄함, 겨울 울산이 아니면 볼 수 없습니다',
      place:   '겨울의 울산은 차갑지만, 그 속에 담긴 스케일은 압도적입니다.',
      tagline: 'ULSAN — 겨울의 깊이',
    },
    {
      main:    '겨울 울산의 웅장함 앞에 오래 서 있었습니다',
      place:   '울산의 겨울은 말없이, 그러나 가장 크게 당신에게 말을 걸어옵니다.',
      tagline: 'ULSAN — 크고 고요한 겨울',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // warmth (따뜻·포근)
  // ════════════════════════════════════════════════════════════════
 
  warmth_spring: [
    {
      main:    '봄 울산의 온기가 마음에 닿은 날',
      place:   '따뜻한 봄볕과 꽃향기, 울산의 봄은 마음을 포근하게 감쌉니다.',
      tagline: 'ULSAN — 봄 온기의 도시',
    },
    {
      main:    '그 따뜻함, 울산의 봄이 건네준 것입니다',
      place:   '봄 울산의 햇살은 차가웠던 것들을 녹여주는 힘이 있습니다.',
      tagline: 'ULSAN — 따뜻한 봄이 있는 곳',
    },
    {
      main:    '봄 울산의 포근함이 온종일 함께했습니다',
      place:   '울산의 봄은 마음속에 오래 남는 따뜻함을 줍니다.',
      tagline: 'ULSAN — 따뜻하게 기억되는 곳',
    },
  ],
 
  warmth_summer: [
    {
      main:    '여름 울산의 따뜻한 기억이 만들어진 날',
      place:   '뜨거운 여름이지만, 울산이 주는 따뜻함은 온도가 아닌 마음입니다.',
      tagline: 'ULSAN — 마음이 따뜻한 도시',
    },
    {
      main:    '그 온기, 여름 울산이 가슴에 남긴 것',
      place:   '여름의 뜨거움 속에서도 울산은 따뜻한 기억을 만들어줍니다.',
      tagline: 'ULSAN — 기억이 따뜻한 곳',
    },
    {
      main:    '여름 울산과 함께한 따뜻한 하루였습니다',
      place:   '울산의 여름은 뜨겁지만, 그 안에 담긴 포근함은 오래 남습니다.',
      tagline: 'ULSAN — 포근한 여름 도시',
    },
  ],
 
  warmth_autumn: [
    {
      main:    '가을 울산의 황금빛 온기가 마음에 닿은 날',
      place:   '황금빛 가을 햇살, 울산이 이 계절에 건네는 따뜻한 인사입니다.',
      tagline: 'ULSAN — 가을 온기의 도시',
    },
    {
      main:    '그 포근함, 가을 울산이 품어준 것입니다',
      place:   '서늘한 가을이지만, 울산의 황금빛 풍경은 마음을 따뜻하게 합니다.',
      tagline: 'ULSAN — 황금빛이 따뜻한 곳',
    },
    {
      main:    '가을 울산의 따뜻한 빛이 오래 남았습니다',
      place:   '울산의 가을은 눈으로 보는 것만으로도 마음이 따뜻해집니다.',
      tagline: 'ULSAN — 눈으로 따뜻한 곳',
    },
  ],
 
  warmth_winter: [
    {
      main:    '차가운 겨울 속 울산의 따뜻함을 만난 날',
      place:   '겨울의 차가움 속에서 울산이 건네는 따뜻함은 더 깊이 스며듭니다.',
      tagline: 'ULSAN — 겨울의 따뜻한 도시',
    },
    {
      main:    '겨울 울산이 마음에 남긴 따뜻한 기억',
      place:   '차가운 계절일수록 울산의 온기는 더 소중하게 느껴집니다.',
      tagline: 'ULSAN — 겨울에 따뜻한 곳',
    },
    {
      main:    '겨울 울산의 포근함이 오래 기억될 것 같습니다',
      place:   '울산의 겨울은 차갑지만, 그 안의 따뜻함은 오랫동안 남아 있습니다.',
      tagline: 'ULSAN — 오래 따뜻한 곳',
    },
  ],
 
  // ════════════════════════════════════════════════════════════════
  // mystery (신비·몽환)
  // ════════════════════════════════════════════════════════════════
 
  mystery_spring: [
    {
      main:    '봄 울산의 신비로운 순간을 만난 날',
      place:   '안개와 꽃이 어우러진 봄, 울산은 때로 꿈속처럼 몽환적입니다.',
      tagline: 'ULSAN — 봄의 신비로운 도시',
    },
    {
      main:    '그 몽환적인 봄, 울산이 만들어낸 것입니다',
      place:   '봄 안개 속의 울산은 현실인지 꿈인지 구분이 안 될 만큼 신비롭습니다.',
      tagline: 'ULSAN — 꿈결 같은 봄',
    },
    {
      main:    '봄 울산의 신비로움이 마음을 사로잡았습니다',
      place:   '울산의 봄은 어디선가 본 듯하면서도, 처음 보는 것처럼 신비롭습니다.',
      tagline: 'ULSAN — 신비가 피어나는 곳',
    },
  ],
 
  mystery_summer: [
    {
      main:    '여름 울산의 신비로운 빛을 만난 날',
      place:   '여름 바다의 깊이, 울산은 그 아래 무엇이 있는지 늘 궁금하게 합니다.',
      tagline: 'ULSAN — 여름의 신비로운 도시',
    },
    {
      main:    '그 몽환적인 여름, 울산의 것이었습니다',
      place:   '뜨거운 여름 울산은 신기루처럼 아름답고 신비롭습니다.',
      tagline: 'ULSAN — 신비로운 여름',
    },
    {
      main:    '여름 울산의 신비로움에 발길이 멈췄습니다',
      place:   '울산의 여름 바다는 그 깊이만큼 신비로운 것들을 품고 있습니다.',
      tagline: 'ULSAN — 깊이를 품은 곳',
    },
  ],
 
  mystery_autumn: [
    {
      main:    '가을 울산의 신비로운 안개가 감싼 날',
      place:   '운해와 단풍이 어우러진 가을, 울산은 가장 몽환적인 표정을 합니다.',
      tagline: 'ULSAN — 가을의 신비로운 도시',
    },
    {
      main:    '그 몽환적인 가을, 울산이 보여준 것입니다',
      place:   '안개 속의 가을 울산은 어느 그림 속 풍경처럼 비현실적으로 아름답습니다.',
      tagline: 'ULSAN — 그림 같은 가을',
    },
    {
      main:    '가을 울산의 신비로움에 오래 머물고 싶었습니다',
      place:   '울산의 가을은 신비롭고 몽환적인 장면들로 가득합니다.',
      tagline: 'ULSAN — 머물고 싶은 가을',
    },
  ],
 
  mystery_winter: [
    {
      main:    '겨울 울산의 신비로운 정적을 만난 날',
      place:   '눈과 안개가 덮인 겨울 울산, 그 고요함 속에 신비로운 무언가가 있습니다.',
      tagline: 'ULSAN — 겨울의 신비로운 도시',
    },
    {
      main:    '그 몽환적인 겨울, 울산이 감춰두었던 것',
      place:   '겨울 울산은 차갑고 고요하지만, 그 안에 말로 다 못할 신비가 있습니다.',
      tagline: 'ULSAN — 신비가 깊어지는 곳',
    },
    {
      main:    '겨울 울산의 신비로움이 오래 마음에 남았습니다',
      place:   '차갑고 어두운 겨울일수록 울산의 신비로움은 더 깊어집니다.',
      tagline: 'ULSAN — 깊고 신비로운 겨울',
    },
  ],
};
 
// =============================================================================
// ② 계절 단독 템플릿 (감성 매칭 실패 시 fallback)
// =============================================================================
 
export const SEASON_ONLY_TEMPLATES = {
  spring: [
    {
      main:    '울산의 봄이 당신에게 건넨 인사',
      place:   '꽃이 피고 바람이 부드러워지는 계절, 울산은 가장 화사하게 빛납니다.',
      tagline: 'ULSAN — 봄이 아름다운 도시',
    },
    {
      main:    '봄 울산의 한 장면이 마음에 남았습니다',
      place:   '울산의 봄은 해마다 새롭게, 그러나 언제나 아름답게 찾아옵니다.',
      tagline: 'ULSAN — 봄마다 피어나는 곳',
    },
    {
      main:    '봄 울산과 함께한 소중한 하루였습니다',
      place:   '이 봄날의 기억이 오래도록 당신 곁에 머물기를 바랍니다.',
      tagline: 'ULSAN — 봄날의 도시',
    },
  ],
  summer: [
    {
      main:    '여름 울산이 당신에게 남긴 기억',
      place:   '뜨겁고 생동감 넘치는 여름, 울산은 가장 강렬하게 당신을 맞이했습니다.',
      tagline: 'ULSAN — 뜨거운 여름 도시',
    },
    {
      main:    '여름 울산의 한 순간이 오래 남았습니다',
      place:   '울산의 여름은 강렬하고 선명하게 기억 속에 새겨집니다.',
      tagline: 'ULSAN — 여름이 선명한 곳',
    },
    {
      main:    '여름 울산과 함께한 특별한 하루였습니다',
      place:   '이 여름날의 울산이 오래도록 당신의 기억 속에 빛나기를 바랍니다.',
      tagline: 'ULSAN — 여름의 도시',
    },
  ],
  autumn: [
    {
      main:    '가을 울산이 당신에게 건넨 황금빛 인사',
      place:   '황금빛으로 물드는 계절, 울산은 가장 풍성하고 아름다운 표정을 합니다.',
      tagline: 'ULSAN — 황금빛 가을 도시',
    },
    {
      main:    '가을 울산의 한 장면이 마음에 새겨졌습니다',
      place:   '울산의 가을은 해마다 새로운 아름다움으로 당신을 맞이합니다.',
      tagline: 'ULSAN — 가을이 아름다운 곳',
    },
    {
      main:    '가을 울산과 함께한 소중한 시간이었습니다',
      place:   '이 가을날의 기억이 오래도록 따뜻하게 당신 곁에 남기를 바랍니다.',
      tagline: 'ULSAN — 가을날의 도시',
    },
  ],
  winter: [
    {
      main:    '겨울 울산이 당신에게 건넨 고요한 인사',
      place:   '차갑고 선명한 겨울, 울산은 가장 고요하고 깊은 표정을 합니다.',
      tagline: 'ULSAN — 겨울이 아름다운 도시',
    },
    {
      main:    '겨울 울산의 한 장면이 마음에 남았습니다',
      place:   '울산의 겨울은 차갑지만, 그만큼 선명하고 깊이 기억됩니다.',
      tagline: 'ULSAN — 겨울이 깊은 곳',
    },
    {
      main:    '겨울 울산과 함께한 고요한 하루였습니다',
      place:   '이 겨울날의 기억이 오래도록 당신 마음속에 따뜻하게 남기를 바랍니다.',
      tagline: 'ULSAN — 겨울날의 도시',
    },
  ],
};
 
// =============================================================================
// ③ 공통 최종 폴백 템플릿 (모든 매칭 실패 시)
// =============================================================================
 
export const COMMON_FALLBACK_TEMPLATES = [
  {
    main:    '울산이 당신에게 건넨 소중한 순간',
    place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 빛나기를 바랍니다.',
    tagline: 'ULSAN — 당신의 울산',
  },
  {
    main:    '이 순간, 울산이 당신과 함께였습니다',
    place:   '울산은 언제나 당신을 기다리고 있습니다. 다시 찾아주세요.',
    tagline: 'ULSAN — 다시 오고 싶은 곳',
  },
  {
    main:    '울산의 한 장면이 마음에 새겨진 날',
    place:   '당신이 만든 울산의 기억은 언제까지나 아름답게 남을 것입니다.',
    tagline: 'ULSAN — 기억이 아름다운 곳',
  },
  {
    main:    '울산과 함께한 특별한 시간이었습니다',
    place:   '이 소중한 만남을 담아 울산이 드리는 작은 선물입니다.',
    tagline: 'ULSAN — 특별한 만남의 도시',
  },
  {
    main:    '당신의 방문이 울산을 더욱 빛나게 합니다',
    place:   '울산은 당신과 함께한 이 순간을 소중히 기억하겠습니다.',
    tagline: 'ULSAN — 빛나는 도시',
  },
];
 
// =============================================================================
// ④ 핵심 선택 함수
// =============================================================================
 
/**
 * 지배 감성 + 계절 조합으로 템플릿을 선택한다.
 *
 * 선택 우선순위:
 *   1. dominantEmotion + season 조합 → EMOTION_SEASON_TEMPLATES
 *   2. season 단독               → SEASON_ONLY_TEMPLATES
 *   3. 공통 폴백                 → COMMON_FALLBACK_TEMPLATES
 *
 * diversitySeed로 같은 조합에서도 다른 변형이 선택된다.
 *
 * @param {Object} params
 * @param {string} params.dominantEmotion  'amazement'|'peace'|... (emotion-engine 키값)
 * @param {string} params.season           'spring'|'summer'|'autumn'|'winter'
 * @param {number} params.diversitySeed    결정론적 변형 선택용 시드
 * @returns {{ main:string, place:string, tagline:string, tier:string }}
 *
 * @example
 * selectTemplate({ dominantEmotion: 'peace', season: 'autumn', diversitySeed: 42 });
 * // → {
 * //     main:    '가을 울산의 고요가 잠시 당신 것이었습니다',
 * //     place:   '낙엽이 내려앉는 소리만이 가득한 울산의 가을.',
 * //     tagline: 'ULSAN — 가을 고요의 도시',
 * //     tier:    'emotion_season',
 * //   }
 */
export function selectTemplate({ dominantEmotion, season, diversitySeed = 0 }) {
  // ── 1순위: 감성 + 계절 조합 ─────────────────────────────────────
  const comboKey = `${dominantEmotion}_${season}`;
  const comboPool = EMOTION_SEASON_TEMPLATES[comboKey];
 
  if (comboPool?.length > 0) {
    const idx = diversitySeed % comboPool.length;
    return { ...comboPool[idx], tier: 'emotion_season' };
  }
 
  // ── 2순위: 계절 단독 ─────────────────────────────────────────────
  const seasonPool = SEASON_ONLY_TEMPLATES[season];
 
  if (seasonPool?.length > 0) {
    const idx = diversitySeed % seasonPool.length;
    return { ...seasonPool[idx], tier: 'season_only' };
  }
 
  // ── 3순위: 공통 폴백 ─────────────────────────────────────────────
  const idx = diversitySeed % COMMON_FALLBACK_TEMPLATES.length;
  return { ...COMMON_FALLBACK_TEMPLATES[idx], tier: 'common_fallback' };
}
 
/**
 * 특정 감성의 모든 계절 템플릿 변형 수를 반환한다. (테스트·디버그용)
 *
 * @param {string} dominantEmotion
 * @returns {{ season: string, count: number }[]}
 */
export function countTemplatesByEmotion(dominantEmotion) {
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  return seasons.map((season) => ({
    season,
    count: EMOTION_SEASON_TEMPLATES[`${dominantEmotion}_${season}`]?.length ?? 0,
  }));
}
 
// =============================================================================
// ⑤ 디버그 유틸리티
// =============================================================================
 
/**
 * 전체 템플릿 통계와 선택 결과를 콘솔에 출력한다. (개발 전용)
 * @param {Object} [params]  selectTemplate 파라미터
 */
export function debugPrintTemplates(params = {}) {
  /* eslint-disable no-console */
 
  console.group('📝 ReplyTemplates — 통계');
 
  const emotions = ['amazement','peace','vitality','nostalgia',
                    'freshness','grandeur','warmth','mystery'];
  const seasons  = ['spring','summer','autumn','winter'];
 
  // 전체 템플릿 수
  let total = 0;
  emotions.forEach((e) => {
    seasons.forEach((s) => {
      const n = EMOTION_SEASON_TEMPLATES[`${e}_${s}`]?.length ?? 0;
      total += n;
    });
  });
 
  console.log(`감성×계절 조합 템플릿: ${Object.keys(EMOTION_SEASON_TEMPLATES).length}개 조합 / ${total}개 변형`);
  console.log(`계절 단독 템플릿: ${Object.values(SEASON_ONLY_TEMPLATES).flat().length}개`);
  console.log(`공통 폴백 템플릿: ${COMMON_FALLBACK_TEMPLATES.length}개`);
  console.log(`전체: ${total + Object.values(SEASON_ONLY_TEMPLATES).flat().length + COMMON_FALLBACK_TEMPLATES.length}개`);
 
  // 미구성 조합 확인
  const missing = [];
  emotions.forEach((e) => {
    seasons.forEach((s) => {
      if (!EMOTION_SEASON_TEMPLATES[`${e}_${s}`]) missing.push(`${e}_${s}`);
    });
  });
  if (missing.length > 0) {
    console.warn('⚠️ 미구성 조합:', missing.join(', '));
  } else {
    console.log('✅ 32개 조합 모두 구성됨');
  }
 
  // 선택 테스트
  if (params.dominantEmotion || params.season) {
    console.group('🎯 선택 결과');
    const result = selectTemplate({
      dominantEmotion: params.dominantEmotion ?? 'peace',
      season:          params.season          ?? 'autumn',
      diversitySeed:   params.diversitySeed   ?? 0,
    });
    console.log('tier   :', result.tier);
    console.log('main   :', result.main);
    console.log('place  :', result.place);
    console.log('tagline:', result.tagline);
    console.groupEnd();
  }
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  EMOTION_SEASON_TEMPLATES,
  SEASON_ONLY_TEMPLATES,
  COMMON_FALLBACK_TEMPLATES,
  selectTemplate,
  countTemplatesByEmotion,
  debugPrintTemplates,
};
