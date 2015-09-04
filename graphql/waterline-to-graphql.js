import Waterline from 'waterline';
import Connections from '../config/connections';
var sailsMongoAdapter = require('sails-mongo');
var diskAdapter = require('sails-disk');
import _ from 'lodash';
import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLInterfaceType
}
from 'graphql';

import {
  connectionArgs,
  connectionDefinitions,
  connectionFromArray,
  fromGlobalId,
  globalIdField,
  mutationWithClientMutationId,
  nodeDefinitions,
}
from 'graphql-relay';

var Schema = undefined;

export function getGraphQLSchemaFromSailsModels(models) {
  if(Schema) {
    return Schema;
  }

  var GraphQLSchemaManager = {
    types: {},
    queries: {},
    connectionTypes: {},
    mutations: {},
    waterlineModels: models
  };

  let Node = new GraphQLInterfaceType({
    name: 'Node',
    description: 'An object with an ID',
    fields: () => ({
      id: {
        type: new GraphQLNonNull(GraphQLString),
        description: 'The global unique ID of an object'
      },
      type: {
        type: new GraphQLNonNull(GraphQLString),
        description: 'The type of the object'
      }
    }),
    resolveType: (obj) => {
      return obj.type;
    }
  });

  let nodeField = {
    name: 'Node',
    type: Node,
    description: 'A node interface field',
    args: {
      id: {
        type: new GraphQLNonNull(GraphQLString),
        description: 'Id of node interface'
      }
    },
    resolve: (obj, {
      id
    }) => {
      var keys = _.keys(GraphQLSchemaManager);
      var allFinds = keys.map(function(key) {
        var obj = GraphQLSchemaManager[key];
        return obj.model.find({
          id: id
        });
      });
      return Promise.all(allFinds).then(function(values) {
        var foundIndex = -1;
        var foundObjs = values.find(function(value, index) {
          if(value.length == 1) {
            foundIndex = index;
            return true;
          }
        });
        foundObjs[0].type = GraphQLSchemaManager[keys[foundIndex]].type;
        return foundObjs[0];
      });
    }
  };



  _.each(models, function eachInstantiatedModel(thisModel, modelID) {
    GraphQLSchemaManager.types[modelID] = createGraphQLTypeForWaterlineModel(thisModel, modelID, Node,
      GraphQLSchemaManager);
    GraphQLSchemaManager.queries[modelID] = createGraphQLQueries(thisModel, GraphQLSchemaManager.types[modelID],
      modelID);
    GraphQLSchemaManager.connectionTypes[modelID] = createConnectionType(modelID, GraphQLSchemaManager.types[modelID]);
  });


  var queryType = new GraphQLObjectType({
    name: 'Query',
    fields: () => {
      return _.reduce(GraphQLSchemaManager.queries, function(total, obj, key) {
        return _.merge(total, obj);
      }, {
        node: nodeField
      });
    }
  });


  var mutationType = new GraphQLObjectType({
    name: 'Mutation',
    fields: () => ({
      // Add your own mutations here
    })
  });

  Schema = new GraphQLSchema({
    query: queryType
  });

  return Schema;
}


function createGraphQLTypeForWaterlineModel(model, modelID, Node, GraphQLSchemaManager) {
  var attributes = model._attributes;
  return new GraphQLObjectType({
    name: modelID,
    description: model.description,
    interfaces: [Node],
    fields: () => {
      var convertedFields = {};
      _.mapKeys(attributes, function(attribute, key) {
        if(attribute.type) {
          var field = {
            type: waterlineTypesToGraphQLType(attribute),
            description: attribute.description
          };
          convertedFields[key] = field;
        }
      });
      var idField = {
        type: new GraphQLNonNull(GraphQLString)
      };
      var typeField = {
        type: new GraphQLNonNull(GraphQLString)
      };
      convertedFields.id = idField;
      convertedFields.type = typeField;

      var associations = model.associations;
      associations.forEach((association) => {
        var connectionKey;
        if(association.model) {
          connectionKey = association.model;
        } else {
          connectionKey = association.collection;
        }

        var whichQuery = connectionKey + 's';
        convertedFields[association.alias] = {
          type: GraphQLSchemaManager.connectionTypes[connectionKey].connectionType,
          args: connectionArgs,
          resolve: (obj, args) => {
            var searchCriteria = {};
            if(association.collection){
              searchCriteria[association.via] = obj.id;
            }else {
              searchCriteria['id'] = obj[association.alias].id;
            }
            var promise = new Promise(function(resolve, reject) {
              GraphQLSchemaManager.queries[connectionKey][whichQuery].resolve(obj, searchCriteria).then(function(results) {
                var res = connectionFromArray(results, args);
                resolve(res);
              }).catch(function(err) {
                reject(err);
              });
            });
            return promise;
          }
        };
      });
      return convertedFields;
    }
  });
}

function createConnectionType(key, graphQLType) {
  return connectionDefinitions({
    name: key,
    nodeType: graphQLType
  });
}


function createGraphQLQueries(waterlineModel, graphqlType, modelID) {
  var queries = {};
  //query to get by id
  queries[modelID] = {
    type: graphqlType,
    args: {
      id: {
        name: 'id',
        type: new GraphQLNonNull(GraphQLString)
      }
    },
    resolve: (obj, {
      id
    }) => {
      return waterlineModel.find({
        id: id
      }).then(function(result) {
        return result[0];
      });
    }
  };
  //query to find based on search criteria
  queries[modelID + 's'] = {
    type: new GraphQLList(graphqlType),
    resolve: (obj, criteria) => {
      return waterlineModel.find(criteria).populateAll().then(function(results) {
        return results;
      });
    }
  };

  return queries;
}

function createMutationsForWaterlineModel(model, modelID) {

}


function waterlineTypesToGraphQLType(attribute) {
  switch(attribute.type) {
    case 'string':
      return GraphQLString;
    case 'integer':
      return GraphQLInt;
    default:
      return GraphQLString;
  }
}
