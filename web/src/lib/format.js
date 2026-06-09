const SYD = 'Australia/Sydney'

export function flag(code, size) {
  size = size || 80
  if (code.indexOf('gb-') === 0) return 'https://flagcdn.com/' + code + '.svg'
  return 'https://flagcdn.com/w' + size + '/' + code + '.png'
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
