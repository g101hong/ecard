/**
 * @fileoverview test/03_full_pipeline.js
 * @description
 *   울산 E-Card 전체 파이프라인 통합 테스트
 *
 *   소감 텍스트
 *     → emotion-engine.analyzeImpression()   감성 8차원 + 글로벌 색채 파라미터
 *     → reply-engine.generateReplyFromImpression()  E-Card 3단 답글
 *     → svg-engine (color-calculator + svg-patcher)  12패널 색상 → SVG stop-color 패치
 *     → png-exporter.svgToPng()              PNG 저장 (타이포그래피 합성 포함)
 *
 *   GEMINI_API_KEY가 .env에 설정되어 있으면 실제 Gemini API를 호출하고,
 *   없으면 emotion-engine/reply-engine 내부 폴백 로직이 자동으로 동작한다.
 *   (코드 추가 모킹 불필요 — fallback-handler.js / reply-fallback.js가 처리)
 *
 * 실행 방법 (프로젝트 루트에서):
 *   node test/03_full_pipeline.js
 *   node test/03_full_pipeline.js --only=0        특정 샘플만 (인덱스 0)
 *   node test/03_full_pipeline.js --size=800      PNG 출력 크기 지정
 */

'use strict';

import dotenv from 'dotenv';
import path   from 'path';
import { mkdir } from 'fs/promises';

import { analyzeImpression }            from '../emotion-engine/index.js';
import { generateReplyFromImpression }  from '../reply-engine/index.js';
import { calculateAllPanelColors,
         colorTempToFilter }            from '../svg-engine/color-calculator.js';
import { patchSVG, validateSvgAssets }  from '../svg-engine/svg-patcher.js';
import { svgToPng }                     from '../svg-engine/png-exporter.js';

dotenv.config();

// =============================================================================
// ① 테스트용 샘플 소감문
// =============================================================================
//
// 각기 다른 감성·맥락(시간/계절/동행자/이모지)을 유도하도록 구성했다.
// emotion-engine이 8차원 감성 점수를 다르게 산출하는지,
// 그 결과 12패널 색상이 실제로 달라지는지를 확인하는 데 목적이 있다.

const SAMPLES = [
  {
    label: '간절곶 일출 — 경이·따뜻함',
    text:  '간절곶에서 새벽 일출을 봤는데 정말 말이 안 나올 정도로 경이로웠어요. ' +
           '연인이랑 같이 봤는데 하늘이 황금빛으로 물드는 순간 가슴이 뭉클했습니다 🌅😭',
  },
  {
    label: '태화강 십리대숲 — 고요·힐링',
    text:  '태화강 국가정원 십리대숲을 가족과 함께 걸었어요. 대나무 숲 사이로 부는 ' +
           '바람 소리가 너무 평화롭고 마음이 차분해졌습니다. 너무 힐링됐어요 🎋😊',
  },
  {
    label: '신불산 억새평원 — 가을·웅장',
    text:  '신불산 억새평원에 올라갔는데 가을 억새가 바람에 일렁이는 모습이 ' +
           '광활하고 웅장했습니다. 친구들이랑 같이 갔는데 다들 입을 다물지 못했어요 🌾',
  },
  {
    label: '강동 몽돌해변 — 청량·여름',
    text:  '강동 몽돌해변에서 파도 소리 들으면서 몽돌 밟는 느낌이 너무 시원하고 ' +
           '상쾌했어요. 여름 바다 공기가 정말 맑았습니다',
  },
  {
    label: '외고산 옹기마을 — 향수·따뜻함',
    text:  '외고산 옹기마을 혼자 둘러봤는데 옛날 생각이 많이 났어요. 흙냄새도 정겹고 ' +
           '가마의 온기가 느껴져서 마음이 따뜻해졌습니다',
  },
  {
    label: '짧은 입력 — 폴백 경로 확인',
    text:  '좋았어요',
  },
];

// =============================================================================
// ② 유틸리티
// =============================================================================

const EMOTION_LABELS = {
  amazement: '경이', peace: '평화', vitality: '활기', nostalgia: '향수',
  freshness: '청량', grandeur: '웅장', warmth: '따뜻', mystery: '신비',
};

function printEmotionScores(scores) {
  Object.entries(scores).forEach(([k, v]) => {
    const bar = '█'.repeat(Math.round(v / 5)).padEnd(20, '░');
    console.log(`    ${EMOTION_LABELS[k]?.padEnd(4) ?? k.padEnd(4)} ${bar} ${v}`);
  });
}

function printGlobalParams(gp) {
  if (!gp) { console.log('    (globalParams 없음 — 폴백 경로)'); return; }
  console.log(
    `    ΔHue:${gp.deltaHue?.toFixed(1)}°  ΔSat:×${gp.deltaSat?.toFixed(2)}  ` +
    `ΔLight:${gp.deltaLight?.toFixed(3)}  ΔContrast:×${gp.deltaContrast?.toFixed(2)}`,
  );
  console.log(
    `    colorTemp:${gp.colorTemp?.toFixed(0)}K  lightDir:${gp.lightDir?.toFixed(1)}°`,
  );
}

function printPanelColors(colors) {
  colors.forEach((p) => {
    const mark = '';
    console.log(
      `    [${String(p.index).padStart(2)}] ${p.name.padEnd(20)} (${p.svgId})  ` +
      `main:${p.main}  sub:${p.sub}  acc:${p.acc}`,
    );
  });
}

// =============================================================================
// ③ 단일 샘플 처리
// =============================================================================

async function runSample(sample, idx, outputSize) {
  console.log('\n' + '═'.repeat(70));
  console.log(`[${idx}] ${sample.label}`);
  console.log('═'.repeat(70));
  console.log(`소감: "${sample.text}"`);

  // ── STEP 1: emotion-engine — 감성 분석 ────────────────────────────
  const emotionResult = await analyzeImpression(sample.text, { debugMode: false });

  console.log('\n[STEP 1] emotion-engine 결과');
  console.log('  성공 여부 :', emotionResult.success ? '✅ 정상' : `⚠️ 폴백 (tier=${emotionResult.tier})`);
  console.log('  경승지    :', emotionResult.typography.spotEmoji, emotionResult.typography.spotName,
              `(spotIndex=${emotionResult.typography.spotIndex})`);
  console.log('  핵심 감성 :', emotionResult.typography.primaryEmotion);
  console.log('  키워드    :', emotionResult.typography.keywords.join(' · '));
  console.log('  감성 8차원:');
  printEmotionScores(emotionResult.emotionScores);
  console.log('  글로벌 색채 파라미터:');
  printGlobalParams(emotionResult.globalParams);

  // ── STEP 2: reply-engine — E-Card 3단 답글 생성 ───────────────────
  const diversitySeed = emotionResult.meta?.diversitySeed ?? 0;

  const replyResult = await generateReplyFromImpression(
    emotionResult.context && emotionResult.emotionScores
      ? {
          emotionScores:   emotionResult.emotionScores,
          dominantEmotion: emotionResult.typography.dominantEmotion,
          spotIndex:       emotionResult.typography.spotIndex,
          primaryEmotion:  emotionResult.typography.primaryEmotion,
          keywords:        emotionResult.typography.keywords,
          contextAnalysis: {
            timeContext:      { detected: emotionResult.context?.timeContext ?? null,
                                 confidence: emotionResult.context?.timeConfidence ?? 0 },
            seasonContext:    { detected: emotionResult.context?.seasonContext ?? null, confidence: 1 },
            companionContext: { detected: emotionResult.context?.companionContext ?? null, confidence: 1 },
          },
        }
      : {},
    sample.text,
    sample.text,
    diversitySeed,
  );

  console.log('\n[STEP 2] reply-engine 결과');
  console.log('  성공 여부 :', replyResult.success ? '✅ 정상' : `⚠️ 폴백 (tier=${replyResult.tier})`);
  console.log('  main      :', replyResult.reply.main);
  console.log('  place     :', replyResult.reply.place);
  console.log('  tagline   :', replyResult.reply.tagline);

  // ── STEP 3: svg-engine — 12패널 색상 계산 + SVG 패치 ──────────────
  const panelColors      = calculateAllPanelColors(emotionResult.emotionScores, diversitySeed);
  const colorTempFilter  = colorTempToFilter(emotionResult.globalParams?.colorTemp ?? 0);

  console.log('\n[STEP 3] svg-engine — 12패널 색상 계산');
  printPanelColors(panelColors);
  console.log('  colorTempFilter:', colorTempFilter || '(없음 — 중립)');

  const patchedSvg = await patchSVG(emotionResult.emotionScores, diversitySeed);
  console.log('  SVG 패치 완료, 길이:', patchedSvg.length, '자');

  // ── STEP 4: png-exporter — PNG 저장 (타이포그래피 합성) ───────────
  const outDir  = path.resolve('./output');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `test-${String(idx).padStart(2, '0')}.png`);

  await svgToPng(patchedSvg, outPath, outputSize, replyResult.reply);

  console.log('\n[STEP 4] PNG 저장 완료');
  console.log('  경로:', outPath);

  return {
    label: sample.label,
    spotName: emotionResult.typography.spotName,
    primaryEmotion: emotionResult.typography.primaryEmotion,
    reply: replyResult.reply,
    outPath,
    emotionTier: emotionResult.tier,
    replyTier: replyResult.tier,
  };
}

// =============================================================================
// ④ 메인 실행
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const sizeArg = args.find((a) => a.startsWith('--size='));

  const outputSize = sizeArg ? parseInt(sizeArg.split('=')[1], 10) : 1000;

  console.log('🎨 울산 E-Card — 전체 파이프라인 통합 테스트');
  console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '설정됨 ✅ (실제 API 호출)' : '없음 ❌ (폴백 경로로 동작)');
  console.log('출력 PNG 크기 :', outputSize + 'px');

  // ── SVG 자산 ID 검증 (참고용) ────────────────────────────────────
  const assetCheck = await validateSvgAssets();
  console.log('\nSVG 자산 검증:', `${assetCheck.total - assetCheck.missing.length}/${assetCheck.total}`,
    assetCheck.valid ? '✅ 모두 존재' : '⚠️ grad-spot-XX-{main,sub,acc} ID 누락 (색상은 stop-color 패치 대상 없음, PNG 생성은 정상 진행)');

  let targets = SAMPLES.map((s, i) => ({ s, i }));
  if (onlyArg) {
    const idx = parseInt(onlyArg.split('=')[1], 10);
    targets = targets.filter((t) => t.i === idx);
  }

  const results = [];
  for (const { s, i } of targets) {
    try {
      const r = await runSample(s, i, outputSize);
      results.push(r);
    } catch (err) {
      console.error(`\n❌ [${i}] "${s.label}" 처리 중 오류:`, err);
      results.push({ label: s.label, error: err.message });
    }
  }

  // ── 최종 요약 ──────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('📋 최종 요약');
  console.log('═'.repeat(70));
  results.forEach((r, i) => {
    if (r.error) {
      console.log(`  [${i}] ${r.label} → ❌ 오류: ${r.error}`);
    } else {
      console.log(
        `  [${i}] ${r.label}\n` +
        `       경승지: ${r.spotName} | 감성: ${r.primaryEmotion} | ` +
        `tier(emotion=${r.emotionTier}, reply=${r.replyTier})\n` +
        `       답글  : "${r.reply.main}" / "${r.reply.place}" / "${r.reply.tagline}"\n` +
        `       PNG   : ${r.outPath}`,
      );
    }
  });
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
