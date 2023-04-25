// Copyright (c) 2022-2023. Heusala Group Oy. All rights reserved.
// Copyright (c) 2020-2021. Sendanor. All rights reserved.

import "reflect-metadata";
import { EntityMetadata } from "./types/EntityMetadata";
import { isString } from "../core/types/String";

const metadataKey = Symbol("metadata");

function updateMetadata(target: any, setValue: (metadata: EntityMetadata) => void) : void {

    const metadata: EntityMetadata = Reflect.getMetadata(metadataKey, target) || {
        tableName: "",
        idPropertyName: "",
        fields: [],
    };

    setValue(metadata);

    Reflect.defineMetadata(metadataKey, metadata, target);

}

export const Table = (tableName: string) => {
    return (target: any) => {
        updateMetadata(target, (metadata: EntityMetadata) => {
            metadata.tableName = tableName;
        });
    };
};

export const Column = (columnName: string): PropertyDecorator => {
    return (target: any, propertyName : string | symbol) => {

        if (!isString(propertyName)) throw new TypeError(`Only string properties supported. The type was ${typeof propertyName}.`);

        updateMetadata(target.constructor, (metadata: EntityMetadata) => {
            metadata.fields.push({ propertyName, columnName });
        });

    };
};

export const Id = (): PropertyDecorator => {
    return (target: any, propertyName : string | symbol) => {

        if (!isString(propertyName)) throw new TypeError(`Only string properties supported. The type was ${typeof propertyName}.`);

        updateMetadata(target.constructor, (metadata: EntityMetadata) => {
            metadata.idPropertyName = propertyName;
        });

    };
};

export class Entity {
    public getMetadata(): EntityMetadata {
        return Reflect.getMetadata(metadataKey, this.constructor);
    }
}

/**
 * Base type for all supported ID types
 */
export type EntityIdTypes = string | number;
