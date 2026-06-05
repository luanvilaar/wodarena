type BrandLogoProps = {
  variant?: 'mark' | 'full';
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ variant = 'mark', className = '', priority = false }: BrandLogoProps) {
  const size = variant === 'full' ? 160 : 96;
  
  return (
    <img
      src="/Ativo_1.svg"
      alt="WODArena"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      data-priority={priority}
    />
  );
}
