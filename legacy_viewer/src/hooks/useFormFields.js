import { useCallback, useRef, useState } from 'react';

export function useFormFields(initialState) {
  const initialRef = useRef(initialState);
  const [fields, setFields] = useState(initialState);

  const handleChange = useCallback(
    (field) => (eventOrValue) => {
      const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
      setFields((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const reset = useCallback(() => {
    setFields(initialRef.current);
  }, []);

  return {
    fields,
    handleChange,
    reset,
    setFields,
  };
}

