// Shared conservative classification for statement history and notification imports.
export function isOwnTransfer(t) {
  if (typeof t.ownTransfer === 'boolean') return t.ownTransfer;
  return /перевод\s+себе|между\s+своими\s+сч[её]тами|на\s+свой\s+сч[её]т|со\s+своего\s+сч[её]та/i.test(t.note || '');
}
