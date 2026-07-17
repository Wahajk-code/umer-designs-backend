import { Body, Controller, Get, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UsersService } from '@/modules/users/users.service';
import { ListUsersQueryDto } from '@/modules/users/dto/list-users-query.dto';
import { UpdateRoleDto } from '@/modules/users/dto/update-role.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { sanitizeUser, SafeUser } from '@/common/utils/sanitize-user.util';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() authUser: AuthenticatedUser): Promise<SafeUser> {
    const user = await this.usersService.findById(authUser.sub);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return sanitizeUser(user);
  }

  @Get()
  @Roles(Role.ADMIN)
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<{ users: SafeUser[]; total: number; page: number; pageSize: number }> {
    const { users, total } = await this.usersService.list(query.page, query.pageSize);
    return { users: users.map(sanitizeUser), total, page: query.page, pageSize: query.pageSize };
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<SafeUser> {
    const user = await this.usersService.promoteToRole(id, dto.role);
    return sanitizeUser(user);
  }
}
