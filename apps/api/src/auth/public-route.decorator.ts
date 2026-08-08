import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'auth.public-route';
export enum PublicRoute {
  HEALTH = 'health',
  SIGNUP = 'signup',
  LOGIN = 'login',
}
export const Public = (route: PublicRoute) => SetMetadata(PUBLIC_ROUTE_KEY, route);
