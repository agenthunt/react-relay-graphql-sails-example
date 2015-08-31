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

var {
  nodeInterface, nodeField
} = nodeDefinitions(
  (globalId) => {
    var {
      type, id
    } = fromGlobalId(globalId);
    if(type === 'User') {
      return getUser(id);
    } else if(type === 'Widget') {
      return getWidget(id);
    } else {
      return null;
    }
  }, (obj) => {
    if(obj instanceof User) {
      return userType;
    } else if(obj instanceof Widget) {
      return widgetType;
    } else {
      return null;
    }
  }
);
var Schema = undefined;

export function getGraphQLSchemaFromSailsModels(models, cb) {
  var promise = new Promise(function(resolve, reject) {
    if(Schema) {
      return resolve(Schema);
    }
    var GraphQLSchemaManager = {};
    _.each(models, function eachInstantiatedModel(thisModel, modelID) {
      _.bindAll(thisModel);
      var obj = {
        type: createGraphQLTypeForWaterlineModel(thisModel, modelID),
        model: thisModel,
        modelID: modelID
      };
      obj.queries = createGraphQLQueries(obj);
      GraphQLSchemaManager[modelID] = obj;
    });


    var queryType = new GraphQLObjectType({
      name: 'Query',
      fields: () => {
        return _.reduce(GraphQLSchemaManager, function(total, obj, key) {
          return _.merge(total, obj.queries);
        }, {});
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

    return resolve && resolve(Schema);
  });
  return promise;
}

export function getGraphQLSchema(ModelDefinitions, cb) {

  var promise = new Promise(function(resolve, reject) {
    if(Schema) {
      return resolve(Schema);
    }
    let waterLineInstance = new Waterline();
    //load waterline collections
    ModelDefinitions.forEach(function(model) {
      model.connection = 'myLocalDisk';
      waterLineInstance.loadCollection(Waterline.Collection.extend(model));
    });

    // Build A Config Object
    var config = {

      // Setup Adapters
      // Creates named adapters that have have been required
      adapters: {
        'default': diskAdapter,
        disk: diskAdapter
      },

      // Build Connections Config
      // Setup connections using the named adapter configs
      connections: {
        myLocalDisk: {
          adapter: 'disk'
        }
      },

      defaults: {
        migrate: 'drop'
      }

    };

    var GraphQLSchemaManager = {};
    //initialize waterline collections
    waterLineInstance.initialize(config, function(err, initializedWaterlineInstance) {
      if(err) {
        cb && cb(err);
        reject && reject(err);
      } else {
        var models = initializedWaterlineInstance.collections || [];
        _.each(models, function eachInstantiatedModel(thisModel, modelID) {
          _.bindAll(thisModel);
          var obj = {
            type: createGraphQLTypeForWaterlineModel(thisModel, modelID),
            model: thisModel,
            modelID: modelID
          };
          obj.queries = createGraphQLQueries(obj);
          GraphQLSchemaManager[modelID] = obj;
        });


        var queryType = new GraphQLObjectType({
          name: 'Query',
          fields: () => ({
            user: {
              type: GraphQLSchemaManager.user.type,
              args: {
                id: {
                  name: 'id',
                  type: new GraphQLNonNull(GraphQLString)
                }
              },
              resolve: (obj, {
                id
              }) => {
                return GraphQLSchemaManager.user.model.find({
                  id: id
                }).then(function(result) {
                  return result[0];
                });
              }
            },
          })
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

        return resolve && resolve(Schema);
      }
    });

  });
  return promise;
}



function createGraphQLTypeForWaterlineModel(model, modelID) {
  var attributes = model._attributes;
  return new GraphQLObjectType({
    name: modelID,
    description: model.description,
    fields: () => {
      var convertedFields = {};
      _.mapKeys(attributes, function(attribute, key) {
        var field = {
          type: waterlineTypesToGraphQLType(attribute.type),
          description: attribute.description
        };
        convertedFields[key] = field;
      });
      var idField = {
        type: GraphQLString
      };
      convertedFields.id = idField;
      return convertedFields;
    }
  });
}

function createGraphQLQueries(obj) {
  var modelID = obj.modelID;
  var graphqlType = obj.type;
  var waterlineModel = obj.model;
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
    type:  new GraphQLList(graphqlType),
    resolve: (obj, {
      criteria
    }) => {
      return waterlineModel.find({}).then(function(results) {
        return results;
      });
    }
  };
  return queries;
}

function createMutationsForWaterlineModel(model, modelID) {

}


function waterlineTypesToGraphQLType(waterLineType) {
  switch(waterLineType) {
    case 'string':
      return GraphQLString;
    case 'integer':
      return GraphQLInt;
    default:
      return GraphQLString;
  }
}
