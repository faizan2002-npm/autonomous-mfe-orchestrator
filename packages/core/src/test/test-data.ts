/** Fixtures for core logic tests. */
export const testContracts = {
  userService: {
    get: ['id:number', 'name:string', 'email:string'],
    post: ['id:number', 'createdAt:string'],
  },
  orderService: {
    get: ['id:number', 'total:number', 'status:string'],
  },
};

export const testTokens = {
  simple: ['id:number', 'name:string'],
  nested: ['user.id:number', 'user.name:string', 'user.email:string', 'items[].id:number'],
  array: ['items[]:string', 'tags[]:string'],
};
