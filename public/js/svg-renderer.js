/**
 * 외부 정적 자원인 stained-glass.svg 파일을 가져와 DOM에 인라인 삽입하는 함수
 */
export async function loadStainedGlass() {
    const holder = document.getElementById('svg-holder');
    
    try {
        // 서버의 assets 경로로부터 단일 마스터 SVG 에셋을 fetch로 수신
        const response = await fetch('/assets/stained-glass.svg');
        if (!response.ok) throw new Error('SVG 에셋을 불러오지 못했습니다.');
        
        const svgText = await response.text();
        
        // 텍스트 데이터를 HTML 내부에 직접 주입하여 인라인 SVG화 (DOM 제어권 확보)
        holder.innerHTML = svgText;
        
        // 주입된 내적 SVG 태그를 찾아 모바일 화면에 맞춰 반응형 핏 강제 부여
        const svgElement = holder.querySelector('svg');
        if (svgElement) {
            svgElement.removeAttribute('width');
            svgElement.removeAttribute('height');
            svgElement.setAttribute('class', 'w-full h-full object-contain');
        }
        return true;
    } catch (error) {
        console.error('SVG 로딩 에러:', error);
        holder.innerHTML = `<p class="text-xs text-red-400 p-4">도안 로드 실패: ${error.message}</p>`;
        return false;
    }
}

/**
 * 상단 그래픽 영역의 블러 단계를 제어하는 함수
 */
export function setBlurState(isBlur) {
    const wrapper = document.getElementById('svg-wrapper');
    if (isBlur) {
        wrapper.classList.remove('blur-0', 'brightness-100');
        wrapper.classList.add('blur-md', 'brightness-95');
    } else {
        wrapper.classList.remove('blur-md', 'brightness-95');
        wrapper.classList.add('blur-0', 'brightness-100'); // 선명하게 해제
    }
}