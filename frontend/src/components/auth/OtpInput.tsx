import React, { useRef } from 'react';

export default function OtpInput({ value, onChange, length = 6, autoFocus }) {
  const inputsRef = useRef([]);
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length);

  const setDigit = (index, char) => {
    const newDigits = [...digits];
    newDigits[index] = char;
    onChange(newDigits.join('').slice(0, length));
  };

  const handleChange = (index, e) => {
    const val = e.target.value.replace(/\D/g, '');
    if (!val) { setDigit(index, ''); return; }
    const char = val[val.length - 1];
    setDigit(index, char);
    if (index < length - 1) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pasted);
    inputsRef.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex items-center gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-10 h-11 text-center bg-surface-muted border border-border-subtle focus:border-transparent text-foreground text-sm outline-none transition-colors rounded-sm"
        />
      ))}
    </div>
  );
}