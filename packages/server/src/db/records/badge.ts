import { AdxUri } from '@adxp/common'
import * as microblog from '@adxp/microblog'
import { Badge } from '@adxp/microblog'
import { TagAssertion } from '@adxp/microblog/src/types/Badge'
import {
  DataSource,
  Entity,
  Column,
  PrimaryColumn,
  Repository,
  In,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm'
import { DbRecordPlugin } from '../types'
import { UserDid } from '../user-dids'
import { collectionToTableName } from '../util'

const collection = 'bsky/badges'
const tableName = collectionToTableName(collection)

@Entity({ name: tableName })
export class BadgeIndex {
  @PrimaryColumn('varchar')
  uri: string

  @Column('varchar')
  @ManyToOne(() => UserDid, (user) => user.did)
  creator: string

  @Column('varchar')
  subject: string

  @Column('varchar')
  assertionType: string

  @Column({ type: 'varchar', nullable: true })
  assertionTag?: string

  @Column('datetime')
  createdAt: string

  @UpdateDateColumn()
  indexedAt: Date
}

const getFn =
  (repo: Repository<BadgeIndex>) =>
  async (uri: AdxUri): Promise<Badge.Record | null> => {
    const found = await repo.findOneBy({ uri: uri.toString() })
    return found === null ? null : translateDbObj(found)
  }

// @TODO don't think we need these anymore
const getManyFn =
  (repo: Repository<BadgeIndex>) =>
  async (uris: AdxUri[] | string[]): Promise<Badge.Record[]> => {
    const uriStrs = uris.map((u) => u.toString())
    const found = await repo.findBy({ uri: In(uriStrs) })
    return found.map(translateDbObj)
  }

const setFn =
  (repo: Repository<BadgeIndex>) =>
  async (uri: AdxUri, obj: unknown): Promise<void> => {
    if (!microblog.isBadge(obj)) {
      throw new Error('Not a valid badge record')
    }
    const badge = new BadgeIndex()
    badge.uri = uri.toString()
    badge.creator = uri.host
    badge.subject = obj.subject.did
    badge.assertionType = obj.assertion.type
    badge.assertionTag = (obj.assertion as TagAssertion).tag
    badge.createdAt = obj.createdAt
    await repo.save(badge)
  }

const deleteFn =
  (repo: Repository<BadgeIndex>) =>
  async (uri: AdxUri): Promise<void> => {
    await repo.delete({ uri: uri.toString() })
  }

const translateDbObj = (dbObj: BadgeIndex): Badge.Record => {
  return {
    assertion: {
      type: dbObj.assertionType,
      // tag: dbObj.assertionTag, @TODO include this
    },
    subject: {
      did: dbObj.subject,
    },
    createdAt: dbObj.createdAt,
  }
}

export const makePlugin = (
  db: DataSource,
): DbRecordPlugin<Badge.Record, BadgeIndex> => {
  const repository = db.getRepository(BadgeIndex)
  return {
    collection,
    tableName,
    get: getFn(repository),
    getMany: getManyFn(repository),
    set: setFn(repository),
    delete: deleteFn(repository),
    translateDbObj,
  }
}

export default makePlugin
