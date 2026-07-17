import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from '@/modules/auth/auth.service';
import { AuthController } from '@/modules/auth/auth.controller';
import { TokensService } from '@/modules/auth/tokens.service';
import { JwtStrategy } from '@/modules/auth/strategies/jwt.strategy';
import { UsersModule } from '@/modules/users/users.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), UsersModule, ReferralsModule],
  controllers: [AuthController],
  providers: [AuthService, TokensService, JwtStrategy],
  exports: [TokensService],
})
export class AuthModule {}
