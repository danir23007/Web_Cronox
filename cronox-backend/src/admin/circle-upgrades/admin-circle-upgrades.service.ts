import { Injectable } from '@nestjs/common';
import { CircleUpgradeRequestStatus } from '@prisma/client';
import { CircleUpgradeService } from '../../membership/circle-upgrade.service';
import { AdminCircleUpgradeReviewDto } from './dto/admin-circle-upgrade-review.dto';

@Injectable()
export class AdminCircleUpgradesService {
  constructor(private readonly circleUpgradeService: CircleUpgradeService) {}

  list(status?: CircleUpgradeRequestStatus) {
    return this.circleUpgradeService.listAdminRequests(status);
  }

  listAutoRequests(status?: CircleUpgradeRequestStatus) {
    return this.circleUpgradeService.listAdminRequests(status, { from: 2, to: 3 });
  }

  approve(id: string, review: AdminCircleUpgradeReviewDto, adminId?: number) {
    return this.circleUpgradeService.approveRequest(id, review, adminId);
  }

  deny(id: string, review: AdminCircleUpgradeReviewDto, adminId?: number) {
    return this.circleUpgradeService.denyRequest(id, review, adminId);
  }
}
