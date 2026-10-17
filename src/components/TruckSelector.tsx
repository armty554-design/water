import React, { useState, useRef, useEffect } from 'react';

interface TruckOption {
  truckNo: string;
  count: number;
}

interface TruckSelectorProps {
  value: string;
  onChange: (truckNo: string) => void;
  availableTrucks: TruckOption[];
  className?: string;
  fullWidth?: boolean;
}

export const TruckSelector: React.FC<TruckSelectorProps> = ({
  value,
  onChange,
  availableTrucks,
  className = '',
  fullWidth = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with prop changes ONLY when the user is NOT actively typing
  useEffect(() => {
    if (!isFocused) {
      setInputValue(value);
    }
  }, [value, isFocused]);

  // Click outside to close and commit or reset
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);

        const trimmed = inputValue.trim();
        const exactMatch = availableTrucks.find(
          t => t.truckNo.toLowerCase() === trimmed.toLowerCase()
        );
        if (exactMatch) {
          setInputValue(exactMatch.truckNo);
          onChange(exactMatch.truckNo);
        } else if (trimmed && availableTrucks.length > 0) {
          // If there's partial text, check if any filtered truck matches prefix
          const match = availableTrucks.find(t => t.truckNo.toLowerCase().startsWith(trimmed.toLowerCase()));
          if (match) {
            setInputValue(match.truckNo);
            onChange(match.truckNo);
          } else {
            setInputValue(value);
          }
        } else {
          setInputValue(value);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inputValue, availableTrucks, value, onChange]);

  // Filter trucks based on typing
  const filteredTrucks = availableTrucks.filter(t => 
    t.truckNo.toLowerCase().includes(inputValue.trim().toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setIsOpen(true);

    // If typed value matches an available truck exactly, notify parent immediately
    const trimmed = val.trim();
    const exactMatch = availableTrucks.find(
      t => t.truckNo.toLowerCase() === trimmed.toLowerCase()
    );
    if (exactMatch) {
      onChange(exactMatch.truckNo);
    }
  };

  const handleSelectTruck = (truckNo: string) => {
    setInputValue(truckNo);
    onChange(truckNo);
    setIsOpen(false);
    setIsFocused(false);
    if (inputRef.current) {
      inputRef.current.blur();
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    setIsOpen(true);
    e.target.select(); // Highlight text for quick replacement
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredTrucks.length > 0) {
        handleSelectTruck(filteredTrucks[0].truckNo);
      } else if (inputValue.trim()) {
        handleSelectTruck(inputValue.trim());
      }
    } else if (e.key === 'Escape') {
      setInputValue(value);
      setIsOpen(false);
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue('');
    setIsOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full block' : 'inline-block'} ${className}`}>
      <div className="relative flex items-center w-full">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์เบอร์รถ..."
          className={`${fullWidth ? 'w-full' : 'w-40'} text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-lg pl-2.5 pr-12 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-xs`}
        />
        
        <div className="absolute right-1.5 flex items-center gap-1 text-slate-400">
          {inputValue && isFocused && (
            <button
              type="button"
              onMouseDown={handleClear}
              tabIndex={-1}
              className="hover:text-slate-700 p-0.5 text-xs font-semibold"
              title="ล้างข้อความ"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsOpen(!isOpen);
              if (!isOpen) inputRef.current?.focus();
            }}
            tabIndex={-1}
            className="hover:text-slate-700 p-0.5 text-[10px]"
          >
            ▼
          </button>
        </div>
      </div>

      {/* Autocomplete Dropdown List */}
      {isOpen && (
        <div className={`absolute left-0 mt-1 ${fullWidth ? 'w-full' : 'w-56'} max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 text-xs divide-y divide-slate-50`}>
          {filteredTrucks.length === 0 ? (
            <div className="px-3 py-2 text-slate-400 text-[11px] text-center">
              ไม่พบเบอร์รถที่ตรงกับ "{inputValue}"
            </div>
          ) : (
            filteredTrucks.map(t => (
              <div
                key={t.truckNo}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent input blur before click registers
                  handleSelectTruck(t.truckNo);
                }}
                className={`px-3 py-1.5 cursor-pointer flex items-center justify-between transition ${
                  t.truckNo === value
                    ? 'bg-blue-50 text-blue-900 font-bold'
                    : 'text-slate-800 hover:bg-slate-100'
                }`}
              >
                <span>สายรถ {t.truckNo}</span>
                <span className={`text-[10px] font-normal ${t.count > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
                  {t.count} จุดส่ง
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
