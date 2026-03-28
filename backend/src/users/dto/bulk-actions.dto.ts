import { IsArray, IsString } from 'class-validator';

export class BulkAssignRoleDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];

  @IsString()
  roleId!: string;
}

export class BulkDeleteUsersDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}

