// Shared admin types — used across multiple tab components

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_admin: boolean;
  is_active: boolean;
  department_name?: string;
  department_id?: string;
  avatar_url?: string | null;
  notify_email:      boolean;
  notify_gchat:      boolean;
  gchat_webhook_url: string | null;
}

export interface Department { id: string; name: string; code: string }

export interface RouteStep {
  id: string;
  step_order: number;
  label: string;
  action_type: string;
  approver_name?: string;
  approver_id?: string;
  approver_avatar?: string | null;
}

export interface ApprovalRoute {
  id: string;
  name: string;
  stage: string;
  is_active: boolean;
  template_name: string;
  template_code: string;
  template_id: string;
  department_name: string;
  department_id: string;
  steps: RouteStep[];
}

export interface Template { id: string; code: string; title_ja: string }
