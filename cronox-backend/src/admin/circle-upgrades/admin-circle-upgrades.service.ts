import { Injectable } from '@nestjs/common';
import { CircleUpgradeRequestStatus } from '@prisma/client';
import { CircleUpgradeService } from '../../membership/circle-upgrade.service';
import { AdminCircleUpgradeQueryDto } from './dto/admin-circle-upgrade-query.dto';
import { AdminCircleUpgradeReviewDto } from './dto/admin-circle-upgrade-review.dto';

@Injectable()
export class AdminCircleUpgradesService {
  constructor(private readonly circleUpgradeService: CircleUpgradeService) {}

  list(status?: CircleUpgradeRequestStatus, query?: AdminCircleUpgradeQueryDto) {
    return this.circleUpgradeService.listAdminRequests(status, { query });
  }

  listAutoRequests(status?: CircleUpgradeRequestStatus, query?: AdminCircleUpgradeQueryDto) {
    return this.circleUpgradeService.listAdminRequests(status, { from: 2, to: 3, query });
  }

  approve(id: string, review: AdminCircleUpgradeReviewDto, adminId?: number) {
    return this.circleUpgradeService.approveRequest(id, review, adminId);
  }

  deny(id: string, review: AdminCircleUpgradeReviewDto, adminId?: number) {
    return this.circleUpgradeService.denyRequest(id, review, adminId);
  }
}
