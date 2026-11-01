import { Global, Module } from '@nestjs/common';
import { AuditService, IdService, NotificationService, StorageService } from './services';

@Global()
@Module({
  providers: [IdService, AuditService, NotificationService, StorageService],
  exports: [IdService, AuditService, NotificationService, StorageService],
})
export class CommonModule {}
