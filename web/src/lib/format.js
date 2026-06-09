const SYD = 'Australia/Sydney'

// Our team codes aren't all ISO 3166-1 alpha-2; map the odd ones to flagcdn codes.
const FLAG_FIX = {
  bih: 'ba', cgo: 'cd', cpv: 'cv', cur: 'cw', cze: 'cz',
  hai: 'ht', irq: 'iq', jor: 'jo', pan: 'pa', sco: 'gb-sct', uzb: 'uz',
}

export function flag(code, size) {
  size = size || 80
  const c = FLAG_FIX[code] || code
  if (c.indexOf('gb-') === 0) return 'https://flagcdn.com/' + c + '.svg'
  return 'https://flagcdn.com/w' + size + '/' + c + '.png'
}

export function gd(t) { return t.gf - t.ga }

export function fmtTime(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase().replace(/\s/, ' ')
}
export function fmtDay(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}
export function fmtDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function fmtWeekday(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, weekday: 'long' }).format(d)
}
