import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppUser } from '@prisma/client';

export type AuthenticatedUser = Omit<AppUser, 'passwordHash'>;

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
