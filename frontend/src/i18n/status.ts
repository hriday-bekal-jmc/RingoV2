const status = {
  ja: {
    status_draft:           '下書き',
    status_pending:         '申請中',
    status_approved:        '稟議承認済',
    status_rejected:        '却下',
    status_returned:        '差し戻し',
    status_pending_settle:  '未精算',
    status_settle_approved: '精算承認済',
    status_completed:       '完了',
    status_cancelled:       'キャンセル',
  },
  en: {
    status_draft:           'Draft',
    status_pending:         'Pending',
    status_approved:        'Approved',
    status_rejected:        'Rejected',
    status_returned:        'Returned',
    status_pending_settle:  'Settlement Pending',
    status_settle_approved: 'Settlement Approved',
    status_completed:       'Completed',
    status_cancelled:       'Cancelled',
  },
} as const;

export default status;
