// src/app-pages.ts
import Routing from './pages/Routing';
import DoctorDay from './pages/DoctorDay';
import CreateUser from './pages/CreateUser';

export type AppPage = {
  path: string;
  label: string;
  element: JSX.Element;
  permission?: string;
  icon?: React.ReactNode;
};

export function getAccessiblePages(abilities?: string[]): AppPage[] {
  const all: AppPage[] = [
    { path: '/routing', label: 'Routing', element: <Routing />, permission: 'canSeeRouting' },
    { path: '/doctor', label: 'My Day', element: <DoctorDay />, permission: 'canSeeDoctorDay' },
    { path: '/users/create', label: 'Create User', element: <CreateUser />, permission: 'canManageUsers' },
  ];

  // If you’re using abilities/permissions, filter here
  return abilities
    ? all.filter((p) => !p.permission || abilities.includes(p.permission))
    : all;
}
