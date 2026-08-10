import { BadRequestException } from '@nestjs/common';

export interface CreateMt5AccountInput {
  nickname: string;
  server: string;
  accountLogin: number;
  password: string;
}

export interface PatchMt5AccountInput {
  nickname?: string;
  server?: string;
  accountLogin?: number;
  password?: string;
  timeCorrectionHours?: number;
  active?: boolean;
}

const requireString = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string') throw new BadRequestException(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return normalized;
};

export const canonicalizeServer = (value: unknown): string => {
  const server = requireString(value, 'server', 255)
    .normalize('NFKC')
    .replace(/[\t\n\f\r ]+/g, ' ')
    .trim()
    .replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
  if (!server) throw new BadRequestException('server is invalid');
  return server;
};

export const validateAccountLogin = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new BadRequestException('accountLogin is invalid');
  }
  return value as number;
};

export const validateCreateAccount = (value: unknown): CreateMt5AccountInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('request is invalid');
  }
  const input = value as Record<string, unknown>;
  return {
    nickname: requireString(input.nickname, 'nickname', 100),
    server: requireString(input.server, 'server', 255),
    accountLogin: validateAccountLogin(input.accountLogin),
    password: requireString(input.password, 'password', 1024),
  };
};

export const validatePatchAccount = (value: unknown): PatchMt5AccountInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('request is invalid');
  }
  const input = value as Record<string, unknown>;
  const allowed = ['nickname', 'server', 'accountLogin', 'password', 'active', 'timeCorrectionHours'];
  if (!Object.keys(input).length || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new BadRequestException('request is invalid');
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new BadRequestException('active is invalid');
  }
  return {
    ...(input.nickname !== undefined && { nickname: requireString(input.nickname, 'nickname', 100) }),
    ...(input.server !== undefined && { server: requireString(input.server, 'server', 255) }),
    ...(input.accountLogin !== undefined && { accountLogin: validateAccountLogin(input.accountLogin) }),
    ...(input.password !== undefined && { password: requireString(input.password, 'password', 1024) }),
    ...(input.active !== undefined && { active: input.active }),
    ...(input.timeCorrectionHours !== undefined && {
      timeCorrectionHours: Number.isInteger(input.timeCorrectionHours) && Math.abs(input.timeCorrectionHours as number) <= 23
        ? input.timeCorrectionHours as number
        : (() => { throw new BadRequestException('timeCorrectionHours is invalid'); })(),
    }),
  };
};
