/**
 * @fileoverview server/middleware/errorHandler.js
 * @description  전역 오류 처리 미들웨어
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 * Express 라우트 핸들러에서 next(err) 로 전달된 오류를
 * 일관된 JSON 형식으로 응답한다.
 *
 * server/index.js 에서 모든 라우터 등록 후 맨 마지막에 연결:
 *
 *   app.use(errorHandler);
 *
 * ─────────────────────────────────────────────────────────────────
 * 오류 유형별 처리
 * ─────────────────────────────────────────────────────────────────
 *
 *   SyntaxError (JSON 파싱 실패)  → 400
 *   ValidationError               → 400
 *   401 / 403                     → 인증 오류
 *   429                           → 요청 한도 초과
 *   그 외                         → 500
 */

'use strict';

/**
 * 전역 오류 처리 미들웨어
 * Express 의 4-parameter 형식 필수 (err, req, res, next)
 *
 * @param {Error}             err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  // 이미 응답이 시작된 경우 Express 기본 처리에 위임
  if (res.headersSent) {
    return next(err);
  }

  // ── 상태 코드 결정 ──────────────────────────────────────────────
  let status  = err.status || err.statusCode || 500;
  let message = err.message || '서버 오류가 발생했습니다.';

  // JSON 파싱 오류 (잘못된 요청 본문)
  if (err instanceof SyntaxError && err.status === 400) {
    status  = 400;
    message = '요청 형식이 잘못됐습니다 (JSON 오류).';
  }

  // Gemini / 외부 API 오류
  if (err.message?.includes('GEMINI_API_KEY')) {
    status  = 500;
    message = '서버 설정 오류입니다. 관리자에게 문의하세요.';
  }

  // ── 로그 ────────────────────────────────────────────────────────
  if (status >= 500) {
    // 서버 오류는 상세 로그
    console.error(`[오류] ${req.method} ${req.path} → ${status}`);
    console.error(err.stack || err.message);
  } else {
    // 클라이언트 오류는 간략 로그
    console.warn(`[경고] ${req.method} ${req.path} → ${status}: ${message}`);
  }

  // ── 응답 ────────────────────────────────────────────────────────
  res.status(status).json({
    error:  message,
    // 개발 환경에서만 스택 트레이스 포함
    ...(process.env.NODE_ENV === 'development' && status >= 500 && {
      stack: err.stack,
    }),
  });
}

/**
 * 404 핸들러 — 등록되지 않은 API 경로 처리
 * 라우터 등록 후, errorHandler 전에 연결:
 *
 *   app.use(notFoundHandler);
 *   app.use(errorHandler);
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
export function notFoundHandler(req, res) {
  // API 경로만 404 JSON 반환 (정적 파일은 이미 앞에서 처리됨)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: `API 경로를 찾을 수 없습니다: ${req.method} ${req.path}`,
    });
  }
  // API 외 경로는 SPA index.html 로 폴백 (server/index.js 에서 처리)
  res.status(404).send('Not Found');
}

export default { errorHandler, notFoundHandler };
