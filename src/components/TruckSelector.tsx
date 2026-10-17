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
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter trucks based on typing
  const filteredTrucks = availableTrucks.filter(t => 
    t.truckNo.toLowerCase().includes(inputValue.trim().toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setIsOpen(true);
    onChange(val);
  };

  const handleSelectTruck = (truckNo: string) => {
    setInputValue(truckNo);
    onChange(truckNo);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (filteredTrucks.length > 0) {
        handleSelectTruck(filteredTrucks[0].truckNo);
      }
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full block' : 'inline-block'} ${className}`}>
      <div className="relative flex items-center w-full">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์เบอร์รถ เช่น 13106..."
          className={`${fullWidth ? 'w-full' : 'w-36'} text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-lg pl-2.5 pr-6 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-xs`}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          tabIndex={-1}
          className="absolute right-1 text-slate-400 hover:text-slate-700 p-1 text-[10px]"
        >
          ▼
        </button>
      </div>

      {/* Autocomplete Dropdown List */}
      {isOpen && (
        <div className={`absolute left-0 mt-1 ${fullWidth ? 'w-full' : 'w-52'} max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 text-xs`}>
          {filteredTrucks.length === 0 ? (
            <div className="px-3 py-2 text-slate-400 text-[11px] text-center">
              ใช้เบอร์รถ "{inputValue}"
            </div>
          ) : (
            filteredTrucks.map(t => (
              <div
                key={t.truckNo}
                onMouseDown={() => handleSelectTruck(t.truckNo)}
                className={`px-3 py-1.5 cursor-pointer flex items-center justify-between transition ${
                  t.truckNo === value
                    ? 'bg-blue-50 text-blue-900 font-bold'
                    : 'text-slate-800 hover:bg-slate-100'
                }`}
              >
                <span>สายรถ {t.truckNo}</span>
                <span className="text-[10px] text-slate-400 font-normal">
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
