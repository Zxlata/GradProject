import React from 'react';

const GradientButton = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  onClick, 
  type = 'button',
  className = '',
  disabled = false 
}) => {
  const getButtonClass = () => {
    let baseClass = 'btn';
    
    if (variant === 'primary') {
      baseClass += ' btn-gradient';
    } else if (variant === 'outline') {
      baseClass += ' btn-outline-primary';
    } else if (variant === 'ghost') {
      baseClass += ' btn-link text-decoration-none';
    } else if (variant === 'white') {
      baseClass += ' btn-light';
    }
    
    if (size === 'lg') {
      baseClass += ' btn-lg';
    } else if (size === 'sm') {
      baseClass += ' btn-sm';
    }
    
    return `${baseClass} ${className}`;
  };

  return (
    <button 
      type={type} 
      className={getButtonClass()} 
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default GradientButton;
