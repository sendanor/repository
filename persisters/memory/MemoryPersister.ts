// Copyright (c) 2023. Heusala Group Oy <info@heusalagroup.fi>. All rights reserved.

import { Persister } from "../../Persister";
import { Entity, EntityIdTypes } from "../../Entity";
import { EntityMetadata } from "../../types/EntityMetadata";
import { first } from "../../../core/functions/first";
import { isArray } from "../../../core/types/Array";
import { has } from "../../../core/functions/has";
import { filter } from "../../../core/functions/filter";
import { some } from "../../../core/functions/some";
import { map } from "../../../core/functions/map";
import { find } from "../../../core/functions/find";
import { forEach } from "../../../core/functions/forEach";
import { EntityRelationOneToMany } from "../../types/EntityRelationOneToMany";
import { PersisterMetadataManager } from "../../PersisterMetadataManager";
import { PersisterMetadataManagerImpl } from "../../PersisterMetadataManagerImpl";
import { LogLevel } from "../../../core/types/LogLevel";
import { LogService } from "../../../core/LogService";
import { EntityUtils } from "../../EntityUtils";
import { EntityField } from "../../types/EntityField";
import { EntityRelationManyToOne } from "../../types/EntityRelationManyToOne";

const LOG = LogService.createLogger('MemoryPersister');

export interface MemoryItem {
    readonly id    : string | number;
    value : Entity;
}

export function createMemoryItem (
    id : string | number,
    value: Entity
) : MemoryItem {
    return {
        id,
        value
    };
}

export interface MemoryTable {

    items : MemoryItem[];

}

export function createMemoryTable (
    items ?: MemoryItem[]
) : MemoryTable {
    return {
        items: items ?? []
    };
}

export enum MemoryIdType {
    STRING = "STRING",
    NUMBER = "NUMBER",
}

/**
 * Internal ID sequencer for memory items
 */
let ID_SEQUENCER = 0;

/**
 * This persister stores everything in the process memory. It is useful for
 * development purposes.
 */
export class MemoryPersister implements Persister {

    public static setLogLevel (level: LogLevel) {
        LOG.setLogLevel(level);
    }

    private readonly _idType : MemoryIdType;
    private readonly _data : { [tableName: string] : MemoryTable };
    private readonly _metadataManager : PersisterMetadataManager;

    /**
     *
     * @param idType
     * @FIXME: The `idType` should probably be detected from metadata and changeable through annotations
     */
    constructor (
        idType ?: MemoryIdType
    ) {
        this._data = {};
        this._idType = idType ?? MemoryIdType.STRING;
        this._metadataManager = new PersisterMetadataManagerImpl();
    }

    public destroy (): void {
    }

    public setupEntityMetadata (metadata: EntityMetadata) : void {
        this._metadataManager.setupEntityMetadata(metadata);
    }

    public async count<T extends Entity, ID extends EntityIdTypes> (
        metadata: EntityMetadata
    ): Promise<number> {
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) return 0;
        return this._data[tableName].items.length;
    }

    public async countByProperty<T extends Entity, ID extends EntityIdTypes> (
        property: string,
        value: any,
        metadata: EntityMetadata
    ): Promise<number> {
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) return 0;
        return filter(
            this._data[tableName].items,
            (item: MemoryItem) : boolean => has(item.value, property) && value === (item.value as any)[property]
        ).length;
    }

    public async deleteAll<T extends Entity, ID extends EntityIdTypes> (
        metadata: EntityMetadata
    ): Promise<void> {
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) return;
        delete this._data[tableName];
    }

    public async deleteAllById<T extends Entity, ID extends EntityIdTypes> (
        ids: readonly ID[],
        metadata: EntityMetadata
    ): Promise<void> {
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) return;
        this._data[tableName].items = filter(
            this._data[tableName].items,
            (item: MemoryItem) : boolean => !ids.includes(item.id as unknown as ID)
        );
    }

    public async deleteAllByProperty<T extends Entity, ID extends EntityIdTypes> (
        property: string,
        value: any,
        metadata: EntityMetadata
    ): Promise<void> {
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) return;
        this._data[tableName].items = filter(
            this._data[tableName].items,
            (item: MemoryItem) : boolean => has(item.value, property) ? (item.value as any)[property] !== value : true
        );
    }

    public async deleteById<T extends Entity, ID extends EntityIdTypes> (
        id: ID,
        metadata: EntityMetadata
    ): Promise<void> {
        return await this.deleteAllById([id], metadata);
    }

    public async existsByProperty<T extends Entity, ID extends EntityIdTypes> (
        property: string,
        value: any,
        metadata: EntityMetadata
    ): Promise<boolean> {
        const tableName = metadata.tableName;
        if(!has(this._data, tableName)) return false;
        return some(
            this._data[tableName].items,
            (item: MemoryItem) : boolean => has(item.value, property) ? (item.value as any)[property] === value : false
        );
    }

    public async findAll<T extends Entity, ID extends EntityIdTypes> (
        metadata: EntityMetadata
    ): Promise<T[]> {
        const tableName = metadata.tableName;
        if(!has(this._data, tableName)) return [];
        return this._populateRelationsToList(this._prepareItemList(this._data[tableName].items, metadata), metadata);
    }

    public async findAllById<T extends Entity, ID extends EntityIdTypes> (
        ids: readonly ID[],
        metadata: EntityMetadata
    ): Promise<T[]> {
        return this._populateRelationsToList(this._prepareItemList(
            this._filterItems(
                (item: MemoryItem) : boolean => ids.includes( item.id as unknown as ID ),
                metadata.tableName
            ),
            metadata
        ), metadata);
    }

    public async findAllByProperty<T extends Entity, ID extends EntityIdTypes> (
        property: string,
        value: any,
        metadata: EntityMetadata
    ): Promise<T[]> {
        return this._populateRelationsToList(this._prepareItemList(
            this._filterItems(
                (item: MemoryItem) : boolean => has(item.value, property) ? (item.value as any)[property] === value : false,
                metadata.tableName
            ),
            metadata
        ), metadata);
    }

    /**
     * Find entity using the primary ID.
     *
     * @param id The entity primary ID
     * @param metadata The entity metadata
     */
    public async findById<T extends Entity, ID extends EntityIdTypes> (
        id: ID,
        metadata: EntityMetadata
    ): Promise<T | undefined> {
        const item = this._findItem(
            (item: MemoryItem) : boolean => item.id === id,
            metadata.tableName
        );
        if (!item) return undefined;
        return this._populateRelations(this._prepareItem<T>(item, metadata), metadata);
    }

    public async findByProperty<T extends Entity, ID extends EntityIdTypes> (
        property: string,
        value: any,
        metadata: EntityMetadata
    ): Promise<T | undefined> {
        const item = this._findItem(
            (item: MemoryItem) : boolean => has(item.value, property) ? (item.value as any)[property] === value : false,
            metadata.tableName
        );
        if (!item) return undefined;
        return this._populateRelations(this._prepareItem<T>(item, metadata), metadata);
    }

    public async insert<T extends Entity, ID extends EntityIdTypes> (
        entity: T | readonly T[],
        metadata: EntityMetadata
    ): Promise<T> {

        const list = map(
            isArray(entity) ? entity : [entity],
            (item : T) : T => item.clone() as T
        );

        const tableName = metadata.tableName;
        const idPropertyName = metadata.idPropertyName;
        if(!has(this._data, tableName)) {
            this._data[tableName] = createMemoryTable();
        }
        const allIds = map(this._data[tableName].items, (item) => item.id);

        const newItems : MemoryItem[] = map(
            list,
            (item: T) : MemoryItem => {
                if ( !( has(item, idPropertyName) && (item as any)[idPropertyName]) ) {
                    const newId : number = ++ID_SEQUENCER;
                    (item as any)[idPropertyName] = this._idType === MemoryIdType.STRING ? `${newId}` : newId;
                }
                const id = (item as any)[idPropertyName];
                if (!id) {
                    throw new TypeError(`Entity cannot be saved with id as "${id}"`);
                }
                if (allIds.includes(id)) {
                    throw new TypeError(`Entity already stored with id "${id}"`);
                }
                allIds.push(id);
                return createMemoryItem(id, item);
            }
        );

        // Let's call this outside above loop for better error management
        forEach(
            newItems,
            (item) => {
                this._data[tableName].items.push(item);
            }
        );

        // FIXME: We should return more than one if there were more than one
        const firstItem = first(newItems);
        if (!firstItem) throw new TypeError(`Could not add items`);
        return this._populateRelations( this._prepareItem<T>(firstItem, metadata), metadata);
    }

    public async update<T extends Entity, ID extends EntityIdTypes> (
        entity: T,
        metadata: EntityMetadata
    ): Promise<T> {
        entity = entity.clone() as T;
        const tableName = metadata.tableName;
        if (!has(this._data, tableName)) {
            this._data[tableName] = createMemoryTable();
        }
        const idPropertyName = metadata.idPropertyName;
        if (!(idPropertyName && has(entity, idPropertyName))) throw new TypeError(`The entity did not have a property for id: "${idPropertyName}"`);
        const id : ID = (entity as any)[idPropertyName];
        if (!id) throw new TypeError(`The entity did not have a valid entity id at property: "${idPropertyName}": ${id}`);
        const savedItem : MemoryItem | undefined = find(
            this._data[tableName].items,
            (item: MemoryItem) : boolean => item.id === id
        );
        if (savedItem) {
            savedItem.value = entity;
        } else {
            this._data[tableName].items.push( createMemoryItem(id, entity) );
        }
        return this._populateRelations(entity, metadata);
    }

    /**
     * Find previously saved memory item from internal memory.
     *
     * @param callback The match callback
     * @param tableName The table to use for
     * @returns The item if found, otherwise `undefined`
     * @private
     */
    private _findItem<T extends Entity, ID extends EntityIdTypes> (
        callback: (item: MemoryItem) => boolean,
        tableName: string
    ) : MemoryItem | undefined {
        if (!has(this._data, tableName)) return undefined;
        const item = find(this._data[tableName].items, callback);
        if (!item) return undefined;
        return item;
    }

    /**
     * Filters memory items based on the callback result
     *
     * @param callback The test callback
     * @param tableName The table to use
     * @returns The filtered items
     * @private
     */
    private _filterItems (
        callback : (item: MemoryItem) => boolean,
        tableName : string
    ): MemoryItem[] {
        if (!has(this._data, tableName)) return [];
        return filter(this._data[tableName].items, callback);
    }

    /**
     * Returns cloned entities, save to pass outside.
     *
     * @param items
     * @param metadata
     * @private
     */
    private _prepareItemList<T extends Entity> (
        items: readonly MemoryItem[],
        metadata: EntityMetadata
    ) : T[] {
        return map(items, (item: MemoryItem) : T => this._prepareItem(item, metadata));
    }

    /**
     * Returns the cloned entity, save to pass outside.
     *
     * This will also populate relate linked resources.
     *
     * @param item The item to clone
     * @param metadata
     * @private
     */
    private _prepareItem<T extends Entity> (
        item: MemoryItem,
        metadata: EntityMetadata
    ) : T {
        return item.value.clone() as T;
    }

    /**
     * Populates relations to complete list of entities
     */
    private _populateRelationsToList<T extends Entity> (
        list: readonly T[],
        metadata: EntityMetadata
    ) : T[] {
        return map(
            list,
            (item) => this._populateRelations(item, metadata)
        )
    }

    /**
     * Returns the cloned entity, save to pass outside.
     *
     * This will also populate relate linked resources.
     *
     * @param entity The item to populate.
     * @param metadata
     * @private
     */
    private _populateRelations<T extends Entity> (
        entity: T,
        metadata: EntityMetadata
    ) : T {
        return this._populateManyToOneRelations(this._populateOneToManyRelations(entity, metadata), metadata);
    };

    /**
     * Returns the cloned entity, save to pass outside.
     *
     * This will also populate relate linked resources.
     *
     * @param entity The item to populate.
     * @param metadata
     * @private
     */
    private _populateOneToManyRelations<T extends Entity> (
        entity: T,
        metadata: EntityMetadata
    ) : T {

        entity = entity.clone() as T;

        const tableName = metadata.tableName;
        const idPropertyName = metadata.idPropertyName;
        const entityId : string | number | undefined = has(entity, idPropertyName) ? (entity as any)[idPropertyName] as string|number : undefined;
        // LOG.debug(`0. entityId = `, entityId, entity, idPropertyName, tableName);
        const oneToManyRelations = metadata?.oneToManyRelations;

        if (oneToManyRelations?.length) {
            forEach(
                oneToManyRelations,
                (oneToMany: EntityRelationOneToMany) => {
                    let { propertyName, mappedBy, mappedTable } = oneToMany;
                    // LOG.debug(`1. propertyName = `, propertyName, mappedBy, mappedTable);
                    if ( mappedTable && mappedBy ) {
                        const mappedToMetadata = this._metadataManager.getMetadataByTable(mappedTable);
                        // LOG.debug(`2. mappedToMetadata = `,mappedToMetadata);
                        if (mappedToMetadata) {

                            const joinColumn : EntityField | undefined = find(mappedToMetadata.fields, (field: EntityField) : boolean => field.propertyName === mappedBy);
                            // LOG.debug(`3. joinColumn = `,joinColumn);
                            if (joinColumn) {
                                const joinColumnName = joinColumn.columnName;
                                // LOG.debug(`4. joinColumnName = `, joinColumnName, metadata.fields);
                                const joinPropertyName = EntityUtils.getPropertyName(joinColumnName, metadata.fields);
                                // LOG.debug(`5. joinPropertyName = `, joinPropertyName);

                                // LOG.debug(`6. Searching related items for property "${mappedBy}" and inner property "${joinPropertyName}" mapped to table "${mappedTable}" by id "${entityId}"`);
                                const linkedEntities : MemoryItem[] = this._filterItems(
                                    (relatedItem: MemoryItem) : boolean => {
                                        const relatedEntity = relatedItem.value;
                                        // LOG.debug(`7. relatedEntity = `, relatedEntity);
                                        const relatedEntityProperty = has(relatedEntity, mappedBy) ? (relatedEntity as any)[mappedBy] : undefined;
                                        if (relatedEntityProperty) {
                                            // LOG.debug(`8. joinPropertyName = `, joinPropertyName);
                                            // LOG.debug(`9. relatedEntityProperty = `, relatedEntityProperty);
                                            const innerId : string | number | undefined = has(relatedEntityProperty, joinPropertyName) ? relatedEntityProperty[joinPropertyName] : undefined;
                                            // LOG.debug(`10. innerId vs entityId = `, innerId, entityId);
                                            return !!innerId && innerId === entityId;
                                        } else {
                                            return false;
                                        }
                                    },
                                    mappedTable
                                );
                                (entity as any)[propertyName] = this._prepareItemList(
                                    linkedEntities,
                                    mappedToMetadata
                                );
                            }
                        } else {
                            throw new TypeError(`Could not find metadata for linked table "${mappedTable} to populate property "${propertyName}" in table "${tableName}"`);
                        }
                    } else {
                        throw new TypeError(`No link to table exists to populate property "${propertyName}" in table "${tableName}"`);
                    }
                }
            );
        }

        return entity;
    }

    /**
     * Returns the cloned entity, save to pass outside.
     *
     * This will also populate relate linked resources.
     *
     * @param entity The item to populate.
     * @param metadata
     * @private
     */
    private _populateManyToOneRelations<T extends Entity> (
        entity: T,
        metadata: EntityMetadata
    ) : T {
        entity = entity.clone() as T;
        const tableName = metadata.tableName;
        const manyToOneRelations = metadata?.manyToOneRelations;

        if (manyToOneRelations?.length) {
            forEach(
                manyToOneRelations,
                (manyToOne: EntityRelationManyToOne) => {

                    let { propertyName, mappedTable } = manyToOne;
                    // LOG.debug(`1. propertyName = `, propertyName, mappedTable);

                    const joinColumn : EntityField | undefined = find(metadata.fields, (field: EntityField) : boolean => field.propertyName === propertyName);
                    // LOG.debug(`2. joinColumn = `, joinColumn);
                    if (joinColumn) {

                        const joinColumnName = joinColumn.columnName;
                        // LOG.debug(`3. joinColumnName = `, joinColumnName, metadata.fields);

                        if ( !mappedTable ) {
                            throw new TypeError(`No link to table exists to populate property "${propertyName}" in table "${tableName}"`);
                        }

                        const mappedToMetadata = this._metadataManager.getMetadataByTable(mappedTable);
                        // LOG.debug(`4. mappedToMetadata = `, mappedToMetadata);
                        if ( !mappedToMetadata ) {
                            throw new TypeError(`Could not find metadata for linked table "${mappedTable} to populate property "${propertyName}" in table "${tableName}"`);
                        }

                        const relatedEntity = (entity as any)[propertyName];
                        if ( !relatedEntity ) throw new TypeError(`Could not find related entity by property "${propertyName}"`);

                        const joinPropertyName = EntityUtils.getPropertyName(joinColumnName, mappedToMetadata.fields);
                        // LOG.debug(`5. joinPropertyName = `, joinPropertyName);
                        //
                        // LOG.debug(`6. Entity = `, entity);
                        // LOG.debug(`6. Related Entity = `, relatedEntity);

                        const relatedId : string | undefined = has(relatedEntity, joinPropertyName) ? relatedEntity[joinPropertyName] : undefined;
                        if ( !relatedId ) throw new TypeError(`Could not find related entity id by property "${joinPropertyName}"`);

                        // LOG.debug(`7. Related Entity Id = `, relatedId);

                        const relatedTableName = mappedToMetadata.tableName;
                        // LOG.debug(`8. Related Table = `, relatedTableName);
                        const storedRelatedItem : MemoryItem | undefined = this._findItem(
                            (item: MemoryItem) : boolean => item.id === relatedId,
                            relatedTableName
                        );
                        // LOG.debug(`9. storedRelatedItem = `, storedRelatedItem);
                        if (!storedRelatedItem) throw new TypeError(`Could not find related entity by id "${relatedId}" from table "${relatedTableName}"`);

                        (entity as any)[propertyName] = this._populateOneToManyRelations(this._prepareItem(
                            storedRelatedItem,
                            mappedToMetadata
                        ), mappedToMetadata);

                    }
                }
            );
        }

        return entity;
    }

}
