'use strict';

// Display publisher footnote references as unobtrusive superscript characters.
// This is a presentation-only transformation: imported verse text stays intact
// in the database and API responses, so the source markers are never discarded.
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiVerseScriptureText = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  var SUPERSCRIPT = Object.freeze({
    a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ',
    i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ',
    q: 'ᑫ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ',
    y: 'ʸ', z: 'ᶻ',
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻'
  });

  function display(text) {
    return String(text == null ? '' : text).replace(/\[([a-z]|\d+(?:-\d+)?)\]/gi, function(marker, contents) {
      var result = '';
      for (var i = 0; i < contents.length; i++) {
        var character = contents.charAt(i).toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(SUPERSCRIPT, character)) return marker;
        result += SUPERSCRIPT[character];
      }
      return result;
    });
  }

  return { display: display };
});
