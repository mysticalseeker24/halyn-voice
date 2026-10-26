import type { CoreActionId, CoreResponse } from '@halyn/shared';
import type { CoreProposal } from '../grant/require-grant';
import { viewBalance, viewStatement } from './accounts';
import { freezeCard } from './cards';
import type { ExecContext } from './context';
import { waiveFee } from './fees';
import { moveEmiDate } from './loans';
import { transfer } from './transfers';

/** Run the verified, schema-checked action for the grant's customer. */
export function execute(ctx: ExecContext, proposed: CoreProposal): Promise<CoreResponse<CoreActionId>> {
  switch (proposed.action) {
    case 'balance.view':
      return viewBalance(ctx, proposed.params);
    case 'statement.view':
      return viewStatement(ctx, proposed.params);
    case 'card.freeze':
      return freezeCard(ctx, proposed.params);
    case 'fee.waive':
      return waiveFee(ctx, proposed.params);
    case 'emi.move_date':
      return moveEmiDate(ctx, proposed.params);
    case 'transfer.new_payee':
    case 'transfer.saved':
    case 'wire.new':
      return transfer(ctx, proposed);
  }
}
