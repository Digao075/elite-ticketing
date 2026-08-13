import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Role, type User } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  role: Role;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          ...input,
          email: input.email.trim().toLowerCase(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }

      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }
}
