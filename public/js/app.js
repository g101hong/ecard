import { loadStainedGlass, setBlurState } from './svg-renderer.js';
//import { callEmotionApi } from './api.js';
//import { applyColorEngine } from './color-engine.js';

// DOM 생성 직후 코어 로직 초기화 가동
document.addEventListener('DOMContentLoaded', async () => {
    // 1단계: 화면 로드 시 백그라운드에서 즉시 SVG 파일을 가져와 주입
    const isLoaded = await loadStainedGlass();
    
    // 초기에는 무조건 블러가 강하게 유지됩니다 (소감 입력 유도)
    if (isLoaded) {
        setBlurState(true);
    }

    const form = document.getElementById('input-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const textInput = document.getElementById('impression-input').value;
        const loadingLayer = document.getElementById('loading-layer');
        
        // 로딩 활성화
        loadingLayer.classList.remove('hidden');
        
        try {
            // 2단계: 서버로 소감 텍스트 전송하여 가벼운 감성 벡터 JSON 수신 (v3 표준)
            const emotionData = await callEmotionApi(textInput); 
            
            // 3단계: 전달받은 색채 변조 수치를 인라인 SVG 요소(radialGradient)에 즉각 채색
            applyColorEngine(emotionData); 
            
            // 4단계: 단절 없는 전환 - 로딩 가림막을 끄고, 상단 이미지 블러를 전격 해제!
            loadingLayer.classList.add('hidden');
            setBlurState(false); 
            
            // 5단계: 하단 UI 영역을 결과창(3단 답글 패널)으로 교체 전환
            document.getElementById('input-form').classList.add('hidden');
            
            // AI가 생성한 감성 답글 3단 텍스트 삽입
            document.getElementById('reply-main').innerText = emotionData.reply.main;
            document.getElementById('reply-place').innerText = emotionData.reply.place;
            document.getElementById('reply-preview').classList.remove('hidden');
            
        } catch (error) {
            alert('처리에 실패했습니다. 다시 시도해 주세요.');
            loadingLayer.classList.add('hidden');
        }
    });
});