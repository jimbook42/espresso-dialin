/** Charcoal + amber design tokens (dark + warm-paper light). */
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
      fieldLabel: 'text-[10px] uppercase font-bold tracking-[0.14em] text-[#6b6457]',
      sectionTitle: 'text-[10px] font-bold uppercase tracking-[0.2em] text-[#c88a4b]',
      pageTitle: 'text-xs font-bold uppercase tracking-[0.18em] text-[#c88a4b]',
      heading: 'text-[#f5f2eb]',
      strong: 'text-[#f5f2eb] font-bold',
      headerBorder: 'border-[#2e2b26]',
      input:
        'bg-[#211e1a] border-[#2e2b26] text-[#f5f2eb] placeholder-[#6b6457] focus:border-[#c88a4b] focus:outline-none transition-colors',
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      applyRec:
        'bg-[#9a6b38] hover:bg-[#a67a45] text-[#f5f2eb] border border-[#c88a4b]/40 font-bold shadow-[0_4px_14px_rgba(200,138,75,0.28)]',
      ctaSoft: 'bg-[#3d3428] hover:bg-[#4a4032] text-[#f0e6d8] border border-[#5a4f42] font-bold',
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
      metricCell: 'bg-[#211e1a] border border-[#2e2b26] rounded-lg p-2',
      chartToggleActive: 'bg-[#c88a4b] text-[#121110] ring-1 ring-[#e0a660]',
      chartToggleIdle: 'text-[#a09880] hover:text-[#f5f2eb]',
      tempPill: 'bg-[rgba(200,138,75,0.14)] text-[#e0c9a8] border border-[rgba(200,138,75,0.35)]',
      stepperBtn:
        'w-10 h-10 shrink-0 rounded-full border-2 border-[#5a5248] bg-[#1a1815] text-[#f5f2eb] font-bold text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-95 transition-transform',
      tabActive: 'bg-[#211e1a] text-[#c88a4b] shadow-sm',
    };
  }

  return {
    page: 'bg-[#ebe6dc] text-[#2a261f]',
    card: 'bg-[#f3efe6] border border-[#d9d0c2] text-[#2a261f]',
    cardInset: 'bg-[#eae4d8] border border-[#d4cbbd] text-[#2a261f]',
    inset: 'bg-[#e3dcd0] border border-[#cfc4b4] text-[#2a261f]',
    text: 'text-[#2a261f]',
    muted: 'text-[#6b6358]',
    sub: 'text-[#524c43]',
    label: 'text-[#524c43] font-semibold tracking-wide',
    fieldLabel: 'text-[10px] uppercase font-bold tracking-[0.14em] text-[#6b6358]',
    sectionTitle: 'text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a5528]',
    pageTitle: 'text-xs font-bold uppercase tracking-[0.18em] text-[#8a5528]',
    heading: 'text-[#2a261f]',
    strong: 'text-[#2a261f] font-bold',
    headerBorder: 'border-[#d4cbbd]',
    input:
      'bg-[#f7f3eb] border-[#cfc4b4] text-[#2a261f] placeholder-[#8a8276] focus:border-[#b8742f] focus:outline-none transition-colors',
    primary: 'bg-[#c88a4b] hover:bg-[#b8742f] text-[#2a2118] font-bold',
    applyRec:
      'bg-[#b8742f] hover:bg-[#a66628] text-[#f7f3eb] border border-[#9a5f24]/35 font-bold shadow-[0_4px_12px_rgba(154,95,36,0.22)]',
    ctaSoft: 'bg-[#ddd4c4] hover:bg-[#d0c6b4] text-[#2a261f] border border-[#c4b8a6] font-bold',
    accentText: 'text-[#8a5528]',
    badge: 'bg-[rgba(200,138,75,0.18)] text-[#8a5528] border border-[rgba(138,85,40,0.28)]',
    nav: 'bg-[#ebe6dc]/98 border-t border-[#d4cbbd]',
    dock: 'bg-[#ebe6dc]/95 border-t border-[#d4cbbd]',
    modalDivider: 'border-[#d4cbbd]',
    secondaryBtn:
      'bg-[#eae4d8] border border-[#d4cbbd] text-[#524c43] hover:text-[#2a261f] transition-colors',
    ghostBtn: 'text-[#6b6358] hover:text-[#2a261f]',
    track: 'bg-[#ddd4c4]',
    progressTrack: 'bg-[#cfc4b4]',
    chip: 'bg-[#eae4d8] border border-[#d4cbbd] text-[#524c43]',
    freezeHint: 'bg-[rgba(200,138,75,0.14)] border border-[rgba(138,85,40,0.22)]',
    metricCell: 'bg-[#eae4d8] border border-[#d4cbbd] rounded-lg p-2',
    chartToggleActive: 'bg-[#c88a4b] text-[#2a2118] ring-1 ring-[#b8742f]',
    chartToggleIdle: 'text-[#6b6358] hover:text-[#2a261f]',
    tempPill: 'bg-[rgba(200,138,75,0.16)] text-[#7a4a1c] border border-[rgba(138,85,40,0.3)]',
    stepperBtn:
      'w-10 h-10 shrink-0 rounded-full border-2 border-[#a89a88] bg-[#f7f3eb] text-[#2a261f] font-bold text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] active:scale-95 transition-transform',
    tabActive: 'bg-[#eae4d8] text-[#8a5528] shadow-sm',
  };
}
