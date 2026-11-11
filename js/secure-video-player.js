const SECURE_VIDEO_WORKER_URL = 'https://bunny-protector.yamikoestudio.workers.dev/';

async function getHlsVideoUrl(videoId, { signal, timeoutMs = 15000 } = {}) {
    if (typeof videoId !== 'string' || !videoId.trim()) {
        throw new TypeError('A videoId is required.');
    }

    const endpoint = new URL(SECURE_VIDEO_WORKER_URL);
    endpoint.searchParams.set('id', videoId.trim());

    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    let timedOut = false;
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abortRequest, { once: true });
    }
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        let response;
        try {
            response = await fetch(endpoint, { signal: controller.signal });
        } catch (cause) {
            if (timedOut) {
                const error = new Error('Время ожидания ответа видеосервиса истекло.');
                error.code = 'TIMEOUT';
                error.cause = cause;
                throw error;
            }
            if (signal?.aborted) throw cause;

            const error = new Error('Не удалось связаться с видеосервисом (возможна ошибка CORS).');
            error.code = 'NETWORK_ERROR';
            error.cause = cause;
            throw error;
        }

        if (response.status === 403) {
            const error = new Error('Доступ к видео запрещён (HTTP 403).');
            error.status = response.status;
            throw error;
        }
        if (!response.ok) {
            const error = new Error(`Видеосервис вернул HTTP ${response.status}.`);
            error.status = response.status;
            throw error;
        }

        let data;
        try {
            data = await response.json();
        } catch (cause) {
            if (timedOut) {
                const error = new Error('Время ожидания ответа видеосервиса истекло.');
                error.code = 'TIMEOUT';
                error.cause = cause;
                throw error;
            }
            if (signal?.aborted) throw cause;
            const error = new Error('Видеосервис вернул некорректный ответ.');
            error.cause = cause;
            throw error;
        }
        if (data?.success !== true || typeof data.url !== 'string') {
            throw new Error('Видеосервис не смог предоставить видео.');
        }

        const videoUrl = new URL(data.url);
        if (videoUrl.protocol !== 'https:' || videoUrl.username || videoUrl.password) {
            throw new Error('Видеосервис вернул неподдерживаемую ссылку.');
        }
        return videoUrl.href;
    } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', abortRequest);
    }
}

window.getHlsVideoUrl = getHlsVideoUrl;
window.getVideoUrl = getHlsVideoUrl;
