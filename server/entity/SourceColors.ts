import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface SourceColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

@Entity()
export class SourceColors {
  constructor(init?: Partial<SourceColors>) {
    Object.assign(this, init);
  }

  @PrimaryColumn()
  public sourceType: string; // 'trakt', 'tmdb', 'imdb', etc.

  @Column()
  public primaryColor: string;

  @Column()
  public secondaryColor: string;

  @Column()
  public textColor: string;

  @Column({ default: false })
  public isDefault: boolean; // True for system defaults, false for user customizations

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  // Helper method to get color scheme
  public getColorScheme(): SourceColorScheme {
    return {
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      textColor: this.textColor,
    };
  }
}
