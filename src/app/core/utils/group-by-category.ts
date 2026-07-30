import { Service } from '../../api/models/service';

export interface ServiceCategoryGroup<T> {
  id: string;
  name: string;
  sortOrder: number;
  items: T[];
}

// Groups any list of items that each carry a Service by that service's
// category, ordered by the category's sortOrder — same grouping used by
// salon-landing's Services tab and the service-settings list, extracted here
// as a third call site (service <select> dropdowns) needed the identical
// logic against a differently-shaped item (Service directly vs {service:
// Service, ...} wrappers like StaffService), hence the getService callback.
export function groupByServiceCategory<T>(
  items: readonly T[],
  getService: (item: T) => Service,
): ServiceCategoryGroup<T>[] {
  const groups = new Map<string, ServiceCategoryGroup<T>>();
  for (const item of items) {
    const cat = getService(item).category;
    let group = groups.get(cat.id);
    if (!group) {
      group = { id: cat.id, name: cat.name, sortOrder: cat.sortOrder, items: [] };
      groups.set(cat.id, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
