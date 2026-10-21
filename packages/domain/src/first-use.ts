// A self-declaration, not identity/age verification or personal-data consent.
export interface AgeDeclarationRepository {
  declaredAt(userId: string): Promise<Date | null>;
  declareAdult(userId: string): Promise<Date>;
}
