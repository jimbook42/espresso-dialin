/** Charcoal + amber tokens for dark and warm-paper light mode. */
export function getAppTheme(dark) {
  if (dark) {
    return {
      page: 'bg-[#121110] text-[#f5f2eb]',
      card: 'bg-[#1a1815] border border-[#2e2b26] text-[#f5f2eb]',
      cardInset: 'bg-[#211e1a] border border-[#2e2b26]',
      inset: 'bg-[#121110] border border-[#2e2b26]',
      text: 'text-[#f5f2eb]',
      muted: 'text-[#6b6457]',
      sub: 'text-[#a09880]',
      label: 'text-[#a09880] font-semibold tracking-wide',
      heading: 'text-[#f5f2eb]',
      strong: 'text-[#f5f2eb] font-bold',
      headerBorder: 'border-[#2e2b26]',
      input:
        'bg-[#211e1a] border-[#2e2b26] text-[#f5f2eb] placeholder-[#6b6457] focus:border-[#c88a4b] focus:outline-none transition-colors',
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      accentText: 'text-[#c88a4b]',
      badge: 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border border-[rgba(200,138,75,0.25)]',
      nav: 'bg-[#121110]/98 border-t border-[#2e2b26]',
      dock: 'bg-[#121110]/95 border-t border-[#2e2b26]',
      modalDivider: 'border-[#2e2b26]',
      secondaryBtn:
        'bg-[#211e1a] border border-[#2e2b26] text-[#a09880] hover:text-[#f5f2eb] transition-colors',
      ghostBtn: 'text-[#6b6457] hover:text-[#f5f2eb]',
      track: 'bg-[#211e1a]',
      progressTrack: 'bg-[#2e2b26]',
      chip: 'bg-[#211e1a] border border-[#2e2b26] text-[#a09880]',
      freezeHint: 'bg-[rgba(200,138,75,0.06)] border border-[rgba(200,138,75,0.2)]',
      stepperBtn:
        'w-10 h-10 shrink-0 rounded-full border-2 border-[#5a5248] bg-[#1a1815] text-[#f5f2eb] font-bold text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-95 transition-transform',
      tabActive: 'bg-[#211e1a] text-[#c88a4b] shadow-sm',
    };
  }

  return {
    page: 'bg-[#f4f0e8] text-[#1c1914]',
    card: 'bg-[#fffcf7] border border-[#d4cbbd] text-[#1c1914]',
    cardInset: 'bg-[#f0ebe3] border border-[#d4cbbd]',
    inset: 'bg-[#eae4da] border border-[#c9bfb0]',
    text: 'text-[#1c1914]',
    muted: 'text-[#5c564c]',
    sub: 'text-[#4a453c]',
    label: 'text-[#4a453c] font-semibold tracking-wide',
    heading: 'text-[#1c1914]',
    strong: 'text-[#1c1914] font-bold',
    headerBorder: 'border-[#d4cbbd]',
    input:
      'bg-[#fffcf7] border-[#c9bfb0] text-[#1c1914] placeholder-[#7a7368] focus:border-[#b8742f] focus:outline-none transition-colors',
    primary: 'bg-[#c88a4b] hover:bg-[#b8742f] text-[#1c1914] font-bold',
    accentText: 'text-[#9a5f24]',
    badge: 'bg-[rgba(200,138,75,0.15)] text-[#9a5f24] border border-[rgba(154,95,36,0.25)]',
    nav: 'bg-[#f4f0e8]/98 border-t border-[#d4cbbd]',
    dock: 'bg-[#f4f0e8]/95 border-t border-[#d4cbbd]',
    modalDivider: 'border-[#d4cbbd]',
    secondaryBtn:
      'bg-[#f0ebe3] border border-[#d4cbbd] text-[#4a453c] hover:text-[#1c1914] transition-colors',
    ghostBtn: 'text-[#5c564c] hover:text-[#1c1914]',
    track: 'bg-[#e8e0d4]',
    progressTrack: 'bg-[#d4cbbd]',
    chip: 'bg-[#f0ebe3] border border-[#d4cbbd] text-[#4a453c]',
    freezeHint: 'bg-[rgba(200,138,75,0.12)] border border-[rgba(154,95,36,0.22)]',
      stepperBtn:
        'w-10 h-10 shrink-0 rounded-full border-2 border-[#9a8f7f] bg-[#fffcf7] text-[#1c1914] font-bold text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] active:scale-95 transition-transform',
      tabActive: 'bg-[#f0ebe3] text-[#9a5f24] shadow-sm',
  };
}
