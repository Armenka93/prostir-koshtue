/**
 * Sound notifications using Web Audio API
 * Works without any external files
 */

function playTone(freq: number, duration: number, vol: number, type: OscillatorType = 'sine') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
    setTimeout(() => ctx.close(), duration * 1000 + 100)
  } catch {}
}

// "Sent" sound — short high beep (like iMessage sent)
export function playSentSound() {
  playTone(1200, 0.12, 0.08, 'sine')
}

// "Received" sound — two-tone notification (like iMessage receive)
export function playReceiveSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)

    // First tone
    const o1 = ctx.createOscillator()
    o1.connect(gain)
    o1.type = 'sine'
    o1.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    o1.start(ctx.currentTime)
    o1.stop(ctx.currentTime + 0.15)

    // Second tone slightly after
    const o2 = ctx.createOscillator()
    o2.connect(gain)
    o2.type = 'sine'
    o2.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
    o2.start(ctx.currentTime + 0.1)
    o2.stop(ctx.currentTime + 0.28)

    setTimeout(() => ctx.close(), 400)
  } catch {}
}
