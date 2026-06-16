/**
 * @fileoverview server/services/supabase-logger.js
 * @description  소감 데이터를 Supabase(PostgreSQL)에 저장하는 서비스
 *
 * ─────────────────────────────────────────────────────────────────
 * 저장 테이블: impressions
 * ─────────────────────────────────────────────────────────────────
 *   id               bigserial PK (자동)
 *   created_at       timestamptz (자동)
 *   trip_duration    text   — 'day'|'1n2d'|'2n3d'|'3n4d'|'4n+'|null
 *   companion        text   — 'solo'|'family'|'friends'|'couple'|'other'|null
 *   impression_text  text   — 소감 원문
 *   primary_emotion  text   — 핵심 감성 한글
 *   processing_ms    integer — 총 처리 시간 (ms)
 *   is_fallback      boolean — 감성 엔진 폴백 여부
 *
 * ─────────────────────────────────────────────────────────────────
 * 필요 환경변수 (.env)
 * ─────────────────────────────────────────────────────────────────
 *   SUPABASE_URL         https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY service_role JWT 키
 *                        (Supabase 콘솔 → Settings → API)
 *
 * ─────────────────────────────────────────────────────────────────
 * Supabase 테이블 생성 SQL (최초 1회 실행)
 * ─────────────────────────────────────────────────────────────────
 *
 *   create table impressions (
 *     id               bigserial primary key,
 *     created_at       timestamptz default now(),
 *     trip_duration    text,
 *     companion        text,
 *     impression_text  text not null,
 *     primary_emotion  text,
 *     processing_ms    integer,
 *     is_fallback      boolean default false
 *   );
 *
 *   alter table impressions enable row level security;
 *
 *   create policy "service role only"
 *     on impressions for insert
 *     to service_role using (true);
 *
 * ─────────────────────────────────────────────────────────────────
 * 동작 방식
 * ─────────────────────────────────────────────────────────────────
 *   1. 로컬 백업 (logs/impressions.jsonl) 항상 먼저 기록
 *      → Supabase 장애 시에도 데이터 유실 없음
 *   2. 환경변수 미설정 시 백업만 하고 종료 (서버 오류 없음)
 *   3. Supabase REST API INSERT 실패 시 에러를 throw →
 *      호출부(impression.js)의 .catch()가 로그만 남기고 무시
 *      (사용자 응답에는 영향 없음)
 */

'use strict';

import { appendFile } from 'fs/promises';
import path           from 'path';

// ── 환경변수 ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BACKUP_PATH  = path.resolve('./logs/impressions.jsonl');

// ── 저장 함수 ─────────────────────────────────────────────────────

/**
 * 소감 데이터 1건을 Supabase impressions 테이블에 INSERT한다.
 *
 * impression.js에서 res.json() 이후 fire-and-forget으로 호출한다:
 *   saveToSupabase({...}).catch(err => console.error('[Supabase]', err.message));
 *
 * @param {Object}      data
 * @param {string}      data.text             정제된 소감 텍스트
 * @param {string|null} data.tripDuration      여행일정 코드
 * @param {string|null} data.companion         동행 코드
 * @param {string}      data.primaryEmotion    핵심 감성 한글
 * @param {boolean}     data.isFallback        감성 엔진 폴백 여부
 * @param {number}      data.processingTimeMs  총 처리 시간 (ms)
 * @returns {Promise<void>}
 */
export async function saveToSupabase(data) {

  // ① 로컬 백업 — Supabase 장애 시에도 데이터 보존
  await appendFile(
    BACKUP_PATH,
    JSON.stringify({ ...data, savedAt: new Date().toISOString() }) + '\n',
    'utf8',
  ).catch((err) => {
    console.warn('[Supabase] 로컬 백업 실패:', err.message);
  });

  // ② 환경변수 미설정 시 백업만 하고 종료
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn('[Supabase] 환경변수 없음 — 로컬 백업만 저장됨');
    return;
  }

  // ③ Supabase REST API INSERT
  const res = await fetch(`${SUPABASE_URL}/rest/v1/impressions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer':        'return=minimal',  // 응답 본문 없음 (속도 최적화)
    },
    body: JSON.stringify({
      trip_duration:   data.tripDuration   ?? null,
      companion:       data.companion      ?? null,
      impression_text: data.text,
      primary_emotion: data.primaryEmotion ?? null,
      processing_ms:   data.processingTimeMs,
      is_fallback:     data.isFallback,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase INSERT 실패 (${res.status}): ${body}`);
  }
}
