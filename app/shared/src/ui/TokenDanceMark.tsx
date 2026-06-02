import React, { type ImgHTMLAttributes } from 'react';
import tokenDanceLogo from '../assets/tokendance-icon-rounded.svg';

export interface TokenDanceMarkProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {}

export function TokenDanceMark({ alt = 'TokenDance', ...props }: TokenDanceMarkProps) {
  return <img src={tokenDanceLogo} alt={alt} {...props} />;
}
