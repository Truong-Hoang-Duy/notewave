/**
 * Trích xuất âm thanh (Audio) từ file Video ngay trên trình duyệt (iPhone 11 / Windows / macOS)
 * trước khi gửi lên Backend Render Free (512MB RAM).
 *
 * Kiến trúc 3 tầng tự động:
 * 1. Tầng 1 (Mặc định - Siêu tốc bằng phần cứng trình duyệt):
 *    Dùng Web Audio API (`AudioContext.decodeAudioData` + `OfflineAudioContext`) cho các video `.mov`, `.mp4`,
 *    `.m4v`, `.webm` vừa và nhỏ (≤ 160 MB). Tốc độ giải mã phần cứng trên iPhone 11 (A13) / Mac / Windows
 *    nhanh gấp 20–50 lần thời gian thực, trộn về 1 kênh (Mono) 12kHz–16kHz chuẩn giọng nói.
 * 2. Tầng 2 (Dành cho file `.mkv`, `.avi` từ OBS trên Windows/Mac hoặc video nặng > 160 MB):
 *    Tự động tải lười (lazy-load từ CDN khi cần) `@ffmpeg/ffmpeg` WebAssembly chạy ngay trên CPU máy người dùng,
 *    đọc trực tiếp từ File qua `WORKERFS` (không nạp cả GB video vào RAM) và nén ra MP3 Mono 16kHz 32kbps
 *    (1 giờ bài giảng chỉ nặng ~14 MB).
 * 3. Tầng 3 (Dự phòng đám mây):
 *    Nếu trình duyệt chặn WebAudio/WASM và file video nhỏ, gửi trực tiếp lên Deepgram.
 */

export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'amr',
  'aiff',
  'aif',
  'asf',
  'wma',
]

export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  '3gp',
  'flv',
  'wmv',
  'mpeg',
  'mpg',
  'ts',
]

export const ACCEPTED_MEDIA_EXTENSIONS = [...new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])]

// Ngưỡng dùng Web Audio API trực tiếp (160 MB): đủ cho hầu hết video quay trên iPhone 11 hoặc clip bài giảng vừa.
const WEB_AUDIO_MAX_BYTES = 160 * 1024 * 1024
// Các định dạng container máy tính (OBS/Windows) nên ưu tiên đi qua FFmpeg.wasm nếu WebAudio không hỗ trợ tốt.
const PREFER_FFMPEG_EXTENSIONS = new Set(['mkv', 'avi', 'flv', 'wmv', 'mpeg', 'mpg', 'ts'])

export function getFileExtension(filename = '') {
  const parts = String(filename).toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() : ''
}

export function isVideoFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('video/')) return true
  const ext = getFileExtension(file.name)
  return VIDEO_EXTENSIONS.includes(ext)
}

/**
 * Mã hoá mảng Float32Array (1 kênh Mono) sang định dạng chuẩn RIFF WAVE 16-bit PCM.
 */
function encodeMonoWav(samples, sampleRate) {
  const numSamples = samples.length
  const dataBytes = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format = 1
  view.setUint16(22, 1, true) // 1 channel (Mono)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate (sampleRate * 1ch * 2 bytes)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // 16-bit
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Tầng 1: Tách âm thanh bằng Web Audio API (`AudioContext` + `OfflineAudioContext`).
 * Chạy siêu tốc bằng phần cứng trên iPhone 11 (iOS Safari), macOS và Windows.
 */
async function extractViaWebAudio(file, onProgress) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!AudioCtx || !OfflineCtx) {
    throw new Error('Trình duyệt không hỗ trợ Web Audio API.')
  }

  onProgress?.(0.15)
  const arrayBuffer = await file.arrayBuffer()
  onProgress?.(0.45)

  const audioCtx = new AudioCtx()
  let decoded
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer)
  } finally {
    try {
      await audioCtx.close()
    } catch {
      /* ignore */
    }
  }

  if (!decoded || decoded.duration <= 0) {
    throw new Error('Video không có kênh âm thanh.')
  }

  onProgress?.(0.7)
  // Với video bài giảng dài (> 20 phút), dùng 12kHz Mono để file WAV nhẹ (~1.3MB/phút), ngắn hơn dùng 16kHz Mono.
  const targetSampleRate = decoded.duration > 20 * 60 ? 12000 : 16000
  const targetLength = Math.max(1, Math.ceil(decoded.duration * targetSampleRate))

  const offlineCtx = new OfflineCtx(1, targetLength, targetSampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start(0)

  const renderedBuffer = await offlineCtx.startRendering()
  onProgress?.(0.9)

  const monoSamples = renderedBuffer.getChannelData(0)
  const wavBlob = encodeMonoWav(monoSamples, targetSampleRate)
  const stem = file.name.replace(/\.[^/.]+$/, '') || 'video-audio'
  const outFile = new File([wavBlob], `${stem}.wav`, {
    type: 'audio/wav',
    lastModified: Date.now(),
  })
  onProgress?.(1)
  return outFile
}

let ffmpegPromise = null

async function getFfmpegInstance() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
        import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js'),
      ])
      const ffmpeg = new FFmpeg()
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      return ffmpeg
    })().catch((err) => {
      ffmpegPromise = null
      throw err
    })
  }
  return ffmpegPromise
}

/**
 * Tầng 2: Tách và nén âm thanh bằng FFmpeg WebAssembly (hỗ trợ `.mkv`, `.avi` và video hàng trăm MB trên Windows/Mac).
 * Nén ra MP3 16kHz Mono 32kbps (1 giờ bài giảng chỉ nặng ~14 MB, cực kỳ an toàn cho Render Free 512MB RAM).
 */
async function extractViaFfmpegWasm(file, onProgress) {
  onProgress?.(0.1)
  const ffmpeg = await getFfmpegInstance()
  onProgress?.(0.25)

  const progressHandler = ({ progress }) => {
    if (typeof progress === 'number' && Number.isFinite(progress)) {
      onProgress?.(0.25 + Math.min(0.7, Math.max(0, progress) * 0.7))
    }
  }
  ffmpeg.on('progress', progressHandler)

  const id = Math.random().toString(36).slice(2, 8)
  const ext = getFileExtension(file.name) || 'mp4'
  const mountDir = `/work_${id}`
  const outputName = `out_${id}.mp3`
  let mounted = false
  let tempInputName = null

  try {
    let inputPath
    // Ưu tiên mount trực tiếp File qua WORKERFS để không tốn RAM copy toàn bộ video lớn
    try {
      await ffmpeg.createDir(mountDir)
      await ffmpeg.mount('WORKERFS', { files: [file] }, mountDir)
      mounted = true
      inputPath = `${mountDir}/${file.name}`
    } catch {
      tempInputName = `in_${id}.${ext}`
      const buf = new Uint8Array(await file.arrayBuffer())
      await ffmpeg.writeFile(tempInputName, buf)
      inputPath = tempInputName
    }

    const exitCode = await ffmpeg.exec([
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '32k',
      outputName,
    ])
    if (exitCode !== 0) {
      throw new Error(`FFmpeg trả mã lỗi ${exitCode}`)
    }

    const data = await ffmpeg.readFile(outputName)
    if (!data || data.byteLength === 0) {
      throw new Error('Không trích xuất được dữ liệu âm thanh từ video.')
    }

    const stem = file.name.replace(/\.[^/.]+$/, '') || 'video-audio'
    const outFile = new File([data.buffer], `${stem}.mp3`, {
      type: 'audio/mpeg',
      lastModified: Date.now(),
    })
    onProgress?.(1)
    return outFile
  } finally {
    ffmpeg.off('progress', progressHandler)
    try {
      await ffmpeg.deleteFile(outputName)
    } catch {
      /* ignore */
    }
    if (tempInputName) {
      try {
        await ffmpeg.deleteFile(tempInputName)
      } catch {
        /* ignore */
      }
    }
    if (mounted) {
      try {
        await ffmpeg.unmount(mountDir)
        await ffmpeg.deleteDir(mountDir)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Nếu `file` là video, tự động trích xuất riêng kênh âm thanh nhẹ trước khi tải lên máy chủ.
 * Trả về `{ file: FileĐãTách, extracted: boolean, originalSize: number, extractedSize: number }`.
 */
export async function prepareMediaForUpload(file, { onProgress } = {}) {
  if (!isVideoFile(file)) {
    return {
      file,
      extracted: false,
      originalSize: file.size,
      extractedSize: file.size,
    }
  }

  const ext = getFileExtension(file.name)
  const preferFfmpeg = PREFER_FFMPEG_EXTENSIONS.has(ext) || file.size > WEB_AUDIO_MAX_BYTES

  // 1. Thử tách nhanh bằng Web Audio phần cứng trước (nếu không phải .mkv/.avi và dung lượng <= 160MB)
  if (!preferFfmpeg) {
    try {
      const wavFile = await extractViaWebAudio(file, onProgress)
      // Nếu file WAV sau khi tách > 45MB (video dài), ưu tiên nén sang MP3 32kbps bằng FFmpeg.wasm nếu khả dụng
      if (wavFile.size > 45 * 1024 * 1024) {
        try {
          const mp3File = await extractViaFfmpegWasm(file, onProgress)
          return {
            file: mp3File,
            extracted: true,
            originalSize: file.size,
            extractedSize: mp3File.size,
          }
        } catch {
          /* Nếu không tải được WASM, dùng bản WAV 12kHz đã tách */
        }
      }
      return {
        file: wavFile,
        extracted: true,
        originalSize: file.size,
        extractedSize: wavFile.size,
      }
    } catch {
      // Nếu Web Audio không giải mã được codec video này -> chuyển xuống Tầng 2 (FFmpeg.wasm)
    }
  }

  // 2. Tầng 2: Tách và nén bằng FFmpeg.wasm (cho file .mkv, .avi, hoặc video nặng > 160MB trên Windows/Mac)
  try {
    const mp3File = await extractViaFfmpegWasm(file, onProgress)
    return {
      file: mp3File,
      extracted: true,
      originalSize: file.size,
      extractedSize: mp3File.size,
    }
  } catch (ffmpegErr) {
    // 3. Nếu chưa bật FFmpeg.wasm mà ban đầu đã bỏ qua WebAudio, thử lại bằng WebAudio một lần nữa
    if (preferFfmpeg && file.size <= 250 * 1024 * 1024) {
      try {
        const wavFile = await extractViaWebAudio(file, onProgress)
        return {
          file: wavFile,
          extracted: true,
          originalSize: file.size,
          extractedSize: wavFile.size,
        }
      } catch {
        /* ignore */
      }
    }

    // 4. Tầng 3 (Dự phòng đám mây): Nếu video nhỏ (<= 80MB), gửi thẳng lên Deepgram để tách trên cloud
    if (file.size <= 80 * 1024 * 1024) {
      return {
        file,
        extracted: false,
        originalSize: file.size,
        extractedSize: file.size,
      }
    }

    throw new Error(
      ffmpegErr?.message ||
        'Không thể trích xuất âm thanh từ video này trên trình duyệt. Hãy thử đổi sang định dạng MP4/MOV hoặc cắt ngắn video.',
    )
  }
}

